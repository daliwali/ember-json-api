var get = Ember.get, set = Ember.set;
var env;
var responses, fakeServer;

module('integration/specs/href-link-for-resource-collection-test', {
  setup: function() {
    fakeServer = stubServer();

    responses = {
      posts_not_compound: {
        data: {
          type: 'posts',
          id: '1',
          attributes: {
            title: 'Rails is Omakase'
          },
          relationships: {
            comments: {
              links: {
                self: '/posts/1/links/comments',
                related: '/posts/1/comments'
              },
              data: [{
                type: 'comments',
                id: '1'
              },{
                type: 'comments',
                id: '2'
              }]
            }
          }
        }
      },
      post_1_comments: {
        data: [
          {
            type: 'comments',
            id: '1',
            attributes: {
              title: 'good article',
              body: 'ideal for my startup'
            }
          },
          {
            type: 'comments',
            id: '2',
            attributes: {
              title: 'bad article',
              body: 'doesn\'t run Crysis'
            }
          }
        ]
      }
    };

    env = setupStore(setModels());
    env.store.modelFor('post');
    env.store.modelFor('comment');
  },

  teardown: function() {
    Ember.run(env.store, 'destroy');
    shutdownFakeServer(fakeServer);
  }
});

asyncTest('GET /posts/1 calls later GET /posts/1/comments when Posts has async comments', function() {
  var models = setModels({
    commentAsync: true
  });
  env = setupStore(models);

  fakeServer.get('/posts/1', responses.posts_not_compound);
  fakeServer.get('/posts/1/comments', responses.post_1_comments);

  Em.run(function() {
    env.store.find('post', '1').then(function(record) {
      record.get('comments').then(function(comments) {
        var comment1 = comments.objectAt(0);
        var comment2 = comments.objectAt(1);

        equal(comments.get('length'), 2, 'there are 2 comments');

        equal(comment1.get('title'), 'good article', 'comment1 title');
        equal(comment1.get('body'), 'ideal for my startup', 'comment1 body');
        equal(comment2.get('title'), 'bad article', 'comment2 title');
        equal(comment2.get('body'), "doesn't run Crysis", 'comment2 body');
        start();
      });
    });
  });
});

asyncTest('GET /posts/1 calls later GET /posts/1/some_resources when Posts has async someResources (camelized)', function() {
  var models = setModels();
  // Add hasMany someResources relation to Post
  models['post'].reopen({
    someResources: DS.hasMany('someResources', { async: true })
  })

  env = setupStore(models);

  fakeServer.get('/posts/1', {
    data: {
      type: 'posts',
      id: '1',
      attributes: {
        title: 'Rails is Omakase',
      },
      relationships: {
        'some_resources': {
          links: {
            related: '/posts/1/some_resources'
          }
        }
      }
    }
  });

  fakeServer.get('/posts/1/some_resources', {
    data: [
      {
        type: 'some_resources',
        id: 1,
        attributes: {
          title: 'Something 1'
        }
      },
      {
        type: 'some_resources',
        id: 2,
        attributes: {
          title: 'Something 2'
        }
      }
    ]
  });

  Em.run(function() {
    env.store.find('post', '1').then(function(record) {
      record.get('someResources').then(function(someResources) {
        var something1 = someResources.objectAt(0);
        var something2 = someResources.objectAt(1);

        equal(someResources.get('length'), 2, 'there are 2 someResources');

        equal(something1.get('title'), 'Something 1', 'something1 title');
        equal(something2.get('title'), 'Something 2', 'something2 title');
        start();
      });
    });
  });
});
