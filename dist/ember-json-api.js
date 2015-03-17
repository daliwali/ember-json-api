define("json-api-adapter", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var get = Ember.get;

    /**
     * Keep a record of routes to resources by type.
     */

    // null prototype in es5 browsers wont allow collisions with things on the
    // global Object.prototype.
    DS._routes = Ember.create(null);

    DS.JsonApiAdapter = DS.RESTAdapter.extend({
      defaultSerializer: 'DS/jsonApi',

      getRoute: function(typeName, id/*, record */) {
        return DS._routes[typeName + '.' + id]
          || DS._routes[typeName];
      },

      /**
       * Look up routes based on top-level links.
       */
      buildURL: function(typeName, id, record) {
        // FIXME If there is a record, try and look up the self link
        // - Need to use the function from the serializer to build the self key
        // TODO: this basically only works in the simplest of scenarios
        var route = this.getRoute(typeName, id, record);
        if(!route) {
          return this._super(typeName, id, record);
        }

        var url = [];
        var host = get(this, 'host');
        var prefix = this.urlPrefix();
        var param = /\{(.*?)\}/g;

        if (id) {
          if (param.test(route)) {
            url.push(route.replace(param, id));
          } else {
            url.push(route);
          }
        } else {
          url.push(route.replace(param, ''));
        }

        if (prefix) { url.unshift(prefix); }

        url = url.join('/');
        if (!host && url) { url = '/' + url; }

        return url;
      },

      findBelongsTo: function(store, record, url, relationship) {
        var related = record[relationship.key];
        // FIXME Without this, it was making unnecessary calls, but cannot create test to verify.
        if(related) { return; }
        return this.ajax(url, 'GET');
      },

      /**
       * Fix query URL.
       */
      findMany: function(store, type, ids, owner) {
        var id = ids ? ids.join(',') : null;
        console.log('findMany', arguments);
        return this.ajax(this.buildURL(type, id, owner), 'GET');
      },

      /**
       * Cast individual record to array,
       * and match the root key to the route
       */
      createRecord: function(store, type, record) {
        var data = this._serializeData(store, type, record);

        return this.ajax(this.buildURL(type.typeKey), 'POST', {
          data: data
        });
      },

      /**
       * Cast individual record to array,
       * and match the root key to the route
       */
      updateRecord: function(store, type, record) {
        var data = this._serializeData(store, type, record),
          id = get(record, 'id');

        return this.ajax(this.buildURL(type.typeKey, id, record), 'PUT', {
          data: data
        });
      },

      _serializeData: function(store, type, record) {
        var serializer = store.serializerFor(type.typeKey),
          snapshot = record._createSnapshot(),
          pluralType = Ember.String.pluralize(type.typeKey),
          json = {};

        json.data = serializer.serialize(snapshot, { includeId: true });
        if(!json.data.hasOwnProperty('type')) {
          json.data.type = pluralType;
        }
        return json;
      },

      _tryParseErrorResponse:  function(responseText) {
        try {
          return Ember.$.parseJSON(responseText);
        } catch(e) {
          return "Something went wrong";
        }
      },

      ajaxError: function(jqXHR) {
        var error = this._super(jqXHR);
        var response;

        if (jqXHR && typeof jqXHR === 'object') {
          response = this._tryParseErrorResponse(jqXHR.responseText);
          var errors = {};

          if (response &&
              typeof response === 'object' &&
                response.errors !== undefined) {

            Ember.A(Ember.keys(response.errors)).forEach(function(key) {
              errors[Ember.String.camelize(key)] = response.errors[key];
            });
          }

          if (jqXHR.status === 422) {
            return new DS.InvalidError(errors);
          } else{
            return new ServerError(jqXHR.status, response, jqXHR);
          }
        } else {
          return error;
        }
      },

      pathForType: function(type) {
        var decamelized = Ember.String.decamelize(type);
        return Ember.String.pluralize(decamelized).replace(/_/g, '-');
      }
    });

    function ServerError(status, message, xhr) {
      this.status = status;
      this.message = message;
      this.xhr = xhr;

      this.stack = new Error().stack;
    }

    ServerError.prototype = Ember.create(Error.prototype);
    ServerError.constructor = ServerError;

    DS.JsonApiAdapter.ServerError = ServerError;

    __exports__["default"] = DS.JsonApiAdapter;
  });define("json-api-serializer", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var get = Ember.get;
    var isNone = Ember.isNone;
    var HOST = /(^https?:\/\/.*?)(\/.*)/;

    DS.JsonApiSerializer = DS.RESTSerializer.extend({

      primaryRecordKey: 'data',
      sideloadedRecordsKey: 'included',
      relationshipKey: 'self',
      relatedResourceKey: 'related',

      keyForRelationship: function(key) {
        return key;
      },

      /**
       * Flatten links
       */
      normalize: function(type, hash, prop) {
        var json = {};
        for (var key in hash) {
          // This is already normalized
          if (key === 'links') {
            json[key] = hash[key];
            continue;
          }

          var camelizedKey = Ember.String.camelize(key);
          json[camelizedKey] = hash[key];
        }

        return this._super(type, json, prop);
      },

      /**
       * Extract top-level "meta" & "links" before normalizing.
       */
      normalizePayload: function(payload) {
        if(!payload) { return; }
        var data = payload[this.primaryRecordKey];
        if (data) {
          if(Ember.isArray(data)) {
            this.extractArrayData(data, payload);
          } else {
            this.extractSingleData(data, payload);
          }
          delete payload[this.primaryRecordKey];
        }
        if (payload.meta) {
          this.extractMeta(payload.meta);
          delete payload.meta;
        }
        if (payload.links) {
          this.extractRelationships(payload.links, payload);
          delete data.links;
        }
        if (payload[this.sideloadedRecordsKey]) {
          this.extractSideloaded(payload[this.sideloadedRecordsKey]);
          delete payload[this.sideloadedRecordsKey];
        }

        return payload;
      },

      /**
       * Extract top-level "data" containing a single primary data
       */
      extractSingleData: function(data, payload) {
        if(data.links) {
          this.extractRelationships(data.links, data);
          //delete data.links;
        }
        payload[data.type] = data;
        delete data.type;
      },

      /**
       * Extract top-level "data" containing a single primary data
       */
      extractArrayData: function(data, payload) {
        var type = data.length > 0 ? data[0].type : null, serializer = this;
        data.forEach(function(item) {
          if(item.links) {
            serializer.extractRelationships(item.links, item);
            //delete data.links;
          }
        });

        payload[type] = data;
      },

      /**
       * Extract top-level "included" containing associated objects
       */
      extractSideloaded: function(sideloaded) {
        var store = get(this, 'store'), models = {};

        sideloaded.forEach(function(link) {
          var type = link.type;
          delete link.type;
          if(!models[type]) {
            models[type] = [];
          }
          models[type].push(link);
        });

        this.pushPayload(store, models);
      },

      /**
       * Parse the top-level "links" object.
       */
      extractRelationships: function(links, resource) {
        var link, association, id, route, relationshipLink, cleanedRoute, linkKey;

        // Clear the old format
        resource.links = {};

        for (link in links) {
          association = links[link];
          link = Ember.String.camelize(link.split('.').pop());
          if(!association) { continue; }
          if (typeof association === 'string') {
            if (association.indexOf('/') > -1) {
              route = association;
              id = null;
            } else {
              route = null;
              id = association;
            }
            relationshipLink = null;
          } else {
            relationshipLink =  association[this.relationshipKey];
            route = association[this.relatedResourceKey] || relationshipLink;
            id = association.id || association.ids;
          }

          if (route) {
            cleanedRoute = this.removeHost(route);
            resource.links[link] = cleanedRoute;

            // Need clarification on how this is used
            linkKey = (id && cleanedRoute.indexOf('{') < 0) ? link + '.' + id : link;
            DS._routes[linkKey] = cleanedRoute.replace(/^\//, '');
          }
          if(id) {
            resource[link] = id;
          }
        }
        return resource.links;
      },

      removeHost: function(url) {
        return url.replace(HOST, '$2');
      },

      // SERIALIZATION

      serializeIntoHash: function(hash, type, snapshot, options) {
        var pluralType = Ember.String.pluralize(type.typeKey),
          data = this.serialize(snapshot, options);
        if(!data.hasOwnProperty('type')) {
          data.type = pluralType;
        }
        hash[type.typeKey] = data;
      },

      /**
       * Use "links" key, remove support for polymorphic type
       */
      serializeBelongsTo: function(record, json, relationship) {
        var attr = relationship.key;
        var belongsTo = record.belongsTo(attr);
        var type = this.keyForRelationship(relationship.type.typeKey);
        var key = this.keyForRelationship(attr);

        if (isNone(belongsTo)) return;

        json.links = json.links || {};
        json.links[key] = belongsToLink(key, type, get(belongsTo, 'id'));
      },

      /**
       * Use "links" key
       */
      serializeHasMany: function(record, json, relationship) {
        var attr = relationship.key,
          type = this.keyForRelationship(relationship.type.typeKey),
          key = this.keyForRelationship(attr);

        if (relationship.kind === 'hasMany') {
          json.links = json.links || {};
          json.links[key] = hasManyLink(key, type, record, attr);
        }
      }
    });

    function belongsToLink(key, type, value) {
      var link = value;
      if (link) {
        link = {
          id: link,
          type: Ember.String.pluralize(type)
        };
      }
      return link;
    }

    function hasManyLink(key, type, record, attr) {
      var link = record.hasMany(attr).mapBy('id');
      if (link) {
        link = {
          ids: link,
          type: Ember.String.pluralize(type)
        };
      }
      return link;
    }

    __exports__["default"] = DS.JsonApiSerializer;
  });