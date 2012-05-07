var options = { 
  db: {
    host: '127.0.0.1',
    port: 27017,
    name: 'justjs'
  },
  http: {
    port: 3000
  },
  templates: {}
};

var _ = require('underscore');
var fs = require('fs');
var mongo = require('mongodb');
var app = require('express').createServer();

options.templates.post = _.template(fs.readFileSync(__dirname + '/templates/post._', 'utf8'));
options.templates.postBody = _.template(fs.readFileSync(__dirname + '/templates/postBody._', 'utf8'));
options.templates.layout = _.template(fs.readFileSync(__dirname + '/templates/layout._', 'utf8'));

var db;
var postCollection;

app.get('/', function(req, res) {
  postCollection.find().sort({created: -1}).toArray(function(err, posts) {
    if (err)
    {
      throw err;
    }
    sendPage(res, 'index', { posts: posts });
  });
});

app.get('/posts/:slug', function(req, res) {
  var slug = req.params.slug;
  postCollection.findOne({slug: slug}, function(err, post) { 
    if (err)
    {
      throw err;
    }
    if (post)
    {
      sendPage(res, 'post', { post: post });
    }
    else
    {
      res.status(404);
      res.send('Post Not Found');
    }
  });
});

// Render a page template nested in the layout, allowing slots 
// (such as overrides of the page title) to be passed back to the layout 
function sendPage(res, template, data)
{
  var slots = {};
  _.defaults(data, { slots: slots });
  slots.body = renderPartial(template, data);
  res.send(renderPartial('layout', { slots: slots }));
}

function renderPartial(template, data)
{
  if (_.isUndefined(options.templates[template]))
  {
    options.templates[template] = _.template(fs.readFileSync(__dirname + '/templates/' + template + '._', 'utf8'));
  }
  _.defaults(data, { options: options, slots: {}, renderPartial: function(partial, data) {
    _.defaults(data, { slots: slots });
    renderPartial(partial, data);
  }});
  return options.templates[template](data);
}

db = new mongo.Db(options.db.name, new mongo.Server(options.db.host, options.db.port, {}), {});
db.open(function(err, client) {
  postCollection = db.collection('post');
  postCollection.ensureIndex("slug", { unique: true }, function(err, callback) 
  {
    if (err)
    {
      throw err;
    }
    ready();
  });
});

function ready()
{
  app.listen(options.http.port);  
  console.log("Listening on port " + options.http.port);
};
