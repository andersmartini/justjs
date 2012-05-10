var _ = require('underscore');

var options = { 
  db: {
    host: '127.0.0.1',
    port: 27017,
    name: 'justjs'
  },
  http: {
    port: 3000
  },
  templates: {},
  // In production you should override this in config-local.js
  sessionSecret: 'CHANGEME'
};

// Let settings specific to this server override global settings
// Use a local relative path (./) to require a file here in this project
// rather than one in NPM
_.extend(options, require('./config-local.js'));

var fs = require('fs');
var mongo = require('mongodb');
var async = require('async');
var express = require('express');
var passport = require('passport');
var app = express.createServer();

// Use the body parser express middleware to automatically parse
// POST form submissions
app.use(express.bodyParser());
// Make cookies available for sessions, which Passport requires to give us logins
app.use(express.cookieParser());
app.use(express.session({ secret: options.sessionSecret }));
// Now we can configure passport
configurePassport();

// Underscore templates to render various pages
options.templates.post = _.template(fs.readFileSync(__dirname + '/templates/post._', 'utf8'));
options.templates.postBody = _.template(fs.readFileSync(__dirname + '/templates/postBody._', 'utf8'));
options.templates.layout = _.template(fs.readFileSync(__dirname + '/templates/layout._', 'utf8'));

var db;
var postCollection;

async.series([connect, listen], ready);

function connect(callback)
{
  db = new mongo.Db(options.db.name, new mongo.Server(options.db.host, options.db.port, {}), {});
  db.open(function(err, client) {
    postCollection = db.collection('post');
    postCollection.ensureIndex("slug", { unique: true }, function(err, indexName) 
    {
      console.log('Database initialized');
      callback(err);
    });
    // Enhance postCollection with our insertUniquely method
    postCollection.insertUniquely = insertUniquely;
  });
}

function listen(callback)
{
  app.listen(options.http.port);  
  console.log("Listening on port " + options.http.port);
  callback(null);
};

function ready(err, results)
{
  if (err)
  {
    console.log("Uh-oh:");
    console.log(err);
  }
  else
  {
    console.log("Ready");
  }
}

app.get('/', function(req, res) {
  postCollection.find().sort({created: -1}).toArray(function(err, posts) {
    if (err)
    {
      throw err;
    }
    sendPage(req, res, 'index', { posts: posts });
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
      sendPage(req, res, 'post', { post: post });
    }
    else
    {
      res.status(404);
      res.send('Post Not Found');
    }
  });
});

app.get('/new', function(req, res) {
  sendPage(req, res, 'new', {});
});

app.post('/create', function(req, res) {
  var post = _.pick(
    _.defaults(req.body, {'title': '', 'body': ''}), 
    'title', 'body');
  post.slug = slugify(post.title);
  // If there are unique index errors keep adding random digits via
  // uniqueify until we have a unique slug. On success redirect to the
  // index page, where we can see the new post at the top
  postCollection.insertUniquely(post, {}, function(err, docs) {
    res.redirect('/');
  });
});

// Render a page template nested in the layout, allowing slots 
// (such as overrides of the page title) to be passed back to the layout 
function sendPage(req, res, template, data)
{
  // It's useful to be able to access the user's name
  var slots = { 'user': req.user };
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
  _.defaults(data, { options: options, slots: {}, partial: function(partial, partialData) {
    _.defaults(partialData, { slots: data.slots });
    return renderPartial(partial, partialData);
  }});
  return options.templates[template](data);
}

// Create a reasonable slug for use in URLs based on the supplied string
function slugify(s)
{
  // Note: you'll need to use xregexp instead if you need non-Latin character
  // support in slugs

  // Everything not a letter or number becomes a dash
  s = s.replace(/[^A-Za-z0-9]/g, '-');
  // Consecutive dashes become one dash
  s = s.replace(/\-+/g, '-');
  // Leading dashes go away
  s = s.replace(/^\-/, '');
  // Trailing dashes go away
  s = s.replace(/\-$/, '');
  // If the string is empty, supply something so that routes still match
  if (!s.length)
  {
    s = 'none';
  }
  return s.toLowerCase();
}

// Use like this:

// mycollection.insertUniquely = insertUniquely;
// mycollection.insertUniquely(doc, {}, callback);

// You can specify additional options besides 'safe' with the
// second parameter. 'safe' is forced on to detect unique slug errors.

// If there is a conflict with another document that has the same slug, a 
// more unique slug will automatically be generated, in a concurrency-safe way

function insertUniquely(doc, options, callback)
{
  var self = this;
  options.safe = true;
  insertUniquelyBody(doc, options, callback);
  function insertUniquelyBody(doc, options, callback)
  {
    self.insert(doc, options, function(err, docs) {
      if (err)
      {
        // 11000 is the MongoDB error code for attempting to
        // insert two posts with the same slug (a unique 
        // index error). When this happens, add a random
        // digit to the slug and try again until it is unique
        if ((err.code === 11000) && (err.err.indexOf('slug') !== -1))
        {
          doc.slug += (Math.floor(Math.random() * 10)).toString();
          insertUniquelyBody(doc, options, callback);
          return;
        }
      }
      else
      {
        callback(err, docs);
      }
    });
  }
}

function configurePassport()
{
  var TwitterStrategy = require('passport-twitter').Strategy;
  passport.use(new TwitterStrategy(
    options.twitter,
    function(token, tokenSecret, profile, done) {
      // We now have a unique id, username and full name (display name) for the user 
      // courtesy of Twitter. I call the display name 'fullName' for consistency with
      // other situations in which I use a local database of users
      var user = { 'id': profile.id, 'username': profile.username, 'fullName': profile.displayName };
      done(null, user);
    }
  ));

  // It's up to us to tell Passport how to store the current user in the session, and how to take
  // session data and get back a user object. We could store just an id in the session and go back
  // and forth to the complete user object via MySQL or MongoDB lookups, but since the user object
  // is small and changes rarely, we'll save a round trip to the database by storign the user
  // information directly in the session in JSON string format.

  passport.serializeUser(function(user, done) {
    done(null, JSON.stringify(user));
  });

  passport.deserializeUser(function(json, done) {
    var user = JSON.parse(json);
    if (user)
    {
      done(null, user);
    }
    else
    {
      done(new Error("Bad JSON string in session"), null);
    }
  });

  // We must install passport's middleware before we can set routes that depend on it
  app.use(passport.initialize());
  app.use(passport.session());

  // Borrowed from http://passportjs.org/guide/twitter.html

  // Redirect the user to Twitter for authentication.  When complete, Twitter
  // will redirect the user back to the application at
  // /auth/twitter/callback
  app.get('/auth/twitter', passport.authenticate('twitter'));

  // Twitter will redirect the user to this URL after approval.  Finish the
  // authentication process by attempting to obtain an access token.  If
  // access was granted, the user will be logged in.  Otherwise,
  // authentication has failed.
  app.get('/auth/twitter/callback', 
    passport.authenticate('twitter', { successRedirect: '/',
                                       failureRedirect: '/login' }));

  app.get('/logout', function(req, res)
  {
    req.logOut();
    res.redirect('/');
  });

  console.log("Installed passport.initialize");
}
