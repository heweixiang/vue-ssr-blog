const express = require('express')
const router = express.Router()
const db = require('../db/')
const getIp = require('../utils/getIp')
const api = require('../http/')
const localTime = require('../utils/reviseTime')
const confirmToken = require('../middleware/confirmToken')
const unpublishedPermission = require('../middleware/unpublishedPermission')

/***********查询相关**************/

// 抓取文章列表
router.get('/api/front/article/gets', unpublishedPermission, async (req, res) => {
  const params = { publish: req.query.publish }
  const limit = parseInt(req.query.limit) || 8
  const skip = req.query.page * limit - limit
  const project = req.query.content == '0' ? { content: 0 } : {}
  if (req.query.tag) params.tag = req.query.tag
  try {
    const total = await db.article.count(params)
    const articles = await db.article
      .find(params, project)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
    res.json({
      status: 200,
      data: articles,
      total,
      page: parseInt(req.query.page)
    })
  } catch (e) {
    res.status(500).end()
  }
})

// 获取文章详细信息
router.get('/api/front/article/detail', unpublishedPermission, async (req, res) => {
  const { publish, articleId } = req.query
  try {
    const detail = await db.article.find({ publish, articleId })
    res.json({
      status: 200,
      data: detail[0] || {}
    })

    // 获取访客信息
    if (process.env.NODEW_ENV === 'production') {
      // 更新pv
      await db.article.update({ articleId }, { $inc: { pv: 1 } })
      const ipInfo = await api.get('https://ip.help.bj.cn', { ip: getIp(req) })
      if (ipInfo.status === '200' && ipInfo.data.length) {
        const info = ipInfo.data[0]
        await new db.news({
          type: 'pv',
          ip: info.ip,
          lng: info.adlng,
          lat: info.adlat,
          nation: info.nation,
          province: info.province,
          city: info.city,
          district: info.district,
          articleId: detail[0]._id,
          date: new Date()
        }).save()
      }
    }
  } catch (e) {
    res.status(500).end()
  }
})
// 获得上一篇文章和下一篇文章
router.get('/api/front/article/preAndNext', (req, res) => {
  db.article
    .find({ publish: true, date: { $lt: req.query.date } }, { articleId: 1, title: 1, tag: 1 }, (err, doc1) => {
      if (err) {
        res.status(500).end()
      } else {
        db.article
          .find({ publish: true, date: { $gt: req.query.date } }, { articleId: 1, title: 1, tag: 1 }, (err, doc2) => {
            if (err) {
              res.status(500).end()
            } else {
              res.json({ pre: doc1, next: doc2 })
            }
          })
          .limit(1)
      }
    })
    .sort({ _id: -1 })
    .limit(1) //pre使用倒序查询，否则只会显示第一条数据，因为他是最早的
})

// 更新文章的喜欢字段
router.patch('/api/front/article/love', (req, res) => {
  db.article.update({ articleId: req.body.articleId }, { $inc: { likeNum: req.body.num } }, (err, doc) => {
    if (err) {
      res.status(500).end()
    } else {
      res.json({ code: 200 })
      if (process.env.NODEW_ENV === 'production') {
        api.get('http://ip.taobao.com/service/getIpInfo.php', { ip: getIp(req) }).then(data => {
          //将点赞加入到新消息
          if (req.body.num === '1') {
            new db.newMsg({
              ip: getIp(req),
              type: 'like',
              title: req.body.title,
              content: data.data.city + '网友 在' + localTime(Date.now()) + '赞了你的文章--' + req.body.title
            }).save()
          } else {
            //取消赞则将新消息移除
            db.newMsg.remove({ type: 'like', ip: getIp(req), title: req.body.title }, err => {
              if (err) {
                res.status(500).end()
              }
            })
          }
        })
      }
    }
  })
})
// 文章搜索
router.get('/api/front/article/search', unpublishedPermission, (req, res) => {
  const limit = 8
  const skip = req.query.page * limit - limit
  if (req.query.according === 'key') {
    db.article
      .find({ publish: true, title: { $regex: req.query.key, $options: 'i' } }, { content: 0 }, (err, doc) => {
        if (err) {
          res.status(500).end()
        } else {
          res.json(doc)
        }
      })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
    //前台时间轴根据时间范围搜索
  } else {
    const start = new Date(parseInt(req.query.start))
    const end = new Date(parseInt(req.query.end))
    db.article
      .find({ publish: req.query.publish, date: { $gte: start, $lte: end } }, { content: 0 }, (err, doc) => {
        if (err) {
          res.status(500).end()
        } else {
          res.json(doc)
        }
      })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
  }
})

// 推荐文章
router.get('/api/front/article/hot', (req, res) => {
  db.article
    .find({ publish: true }, { title: 1, articleId: 1, tag: 1 }, { sort: { pv: -1 } }, (err, doc) => {
      if (err) {
        res.status(500).end()
      } else {
        res.json(doc)
      }
    })
    .limit(5)
})

/***********后台管理文章： 改动 删除 修改**************/

// 修改文章
router.patch('/api/admin/article/update', confirmToken, (req, res) => {
  const { publish, original, title, abstract, tag, content } = req.body
  db.article.update(
    { articleId: req.body.articleId },
    { publish, original, title, abstract, tag, content },
    (err, doc) => {
      if (err) {
        res.status(500).end()
      } else {
        res.json({ code: 200 })
      }
    }
  )
})
// 存储文章
router.post('/api/admin/article/save', confirmToken, (req, res) => {
  const { original, title, abstract, content, tag, publish, date } = req.body
  new db.article({
    articleId: 0,
    original,
    title,
    abstract,
    content,
    tag,
    publish,
    date: date,
    commentNum: 0,
    likeNum: 0,
    pv: 0
  }).save((err, doc) => {
    if (err) {
      res.json({ code: 500 })
    } else {
      res.json({ code: 200 })
    }
  })
})
// 删除文章
router.delete('/api/admin/article/del', confirmToken, (req, res) => {
  //$in是为了批量删除，出入的articleId是数组
  db.article.remove({ articleId: { $in: req.query.articleId } }, err => {
    if (err) {
      res.status(500).end()
    } else {
      res.json({ deleteCode: 200 })
      db.comment.remove({ articleId: { $in: req.query.articleId } }, err => {
        if (err) {
          console.log(err)
        }
      })
    }
  })
})

module.exports = router
