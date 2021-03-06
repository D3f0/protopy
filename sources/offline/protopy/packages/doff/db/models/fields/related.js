/* "doff.db.models.fields.related" */
require('doff.db.base', 'connection');
require('doff.db.models.loading', 'get_model');
require('doff.db.models.fields.base', 'AutoField', 'Field', 'IntegerField', 'PositiveIntegerField', 'PositiveSmallIntegerField', 'FieldDoesNotExist');
require('doff.db.models.related', 'RelatedObject');
require('doff.db.models.query', 'QuerySet');
require('doff.db.models.query_utils', 'QueryWrapper');
var forms = require('doff.forms.base');
require('doff.core.exceptions', 'ValidationError');
require('doff.db.transaction');
require('functional', 'curry');
require('event');

var RECURSIVE_RELATIONSHIP_CONSTANT = 'this';
var pending_lookups = {};

function add_lazy_relation(cls, field, relation, operation){
    var app_label = null, model_name = null, model = null;

    if (relation == RECURSIVE_RELATIONSHIP_CONSTANT) {
        app_label = cls._meta.app_label;
        model_name = cls.__name__;
    } else {
        //Look for an "app.Model" relation
        [app_label, model_name] = relation.split(".");
        if (!model_name) {
            app_label = cls._meta.app_label;
            model_name = relation;
        }
    }
    model = get_model(app_label, model_name, false);
    if (model)
        operation(field, model, cls);
    else {
        var key = app_label + model_name;
        var value = [cls, field, operation];
        if (!pending_lookups[key])
            pending_lookups[key] = [];
        pending_lookups[key].push(value);
    }
}

function do_pending_lookups(sender) {
    var key = sender._meta.app_label + sender.__name__;
    for each (var value in pending_lookups[key]) {
        var [cls, field, operation] = value;
        operation(field, sender, cls);
    }
    delete pending_lookups[key];
}

var hcp = event.subscribe('class_prepared', do_pending_lookups);

var RelatedField = type('RelatedField', [ Field ], {
    contribute_to_class: function(cls, name) {
        super(Field, this).contribute_to_class(cls, name);

        this.related_query_name = curry(this._get_related_query_name, cls._meta);

        if ((!cls._meta['abstract']) && (this.rel.related_name))
            this.rel.related_name = this.rel.related_name.interpolate({'class': cls.__name__.toLowerCase()});

        var other = this.rel.to;

        if (isinstance(other, String)) {
            function resolve_related_class(field, model, cls){
                field.rel.to = model;
                field.do_related_class(model, cls);
            }
            add_lazy_relation(cls, this, other, resolve_related_class);
        } else {
            this.do_related_class(other, cls);
        }
    },

    set_attributes_from_rel: function(){
        this.name = this.name || (this.rel.to._meta.object_name.toLowerCase() + '_' + this.rel.to._meta.pk.name);
        if (!this.verbose_name)
            this.verbose_name = this.rel.to._meta.verbose_name;
        this.rel.field_name = this.rel.field_name || this.rel.to._meta.pk.name;
    },
    
    do_related_class: function(other, cls) {
        this.set_attributes_from_rel();
        var related = new RelatedObject(other, cls, this);
        if (!cls._meta['abstract'])
            this.contribute_to_related_class(other, related);
    },

    get_db_prep_lookup: function(lookup_type, value) {
        function pk_trace(val) {
            var v = val, field = null;
            try {
                while (true) {
                    [ v, field ] = [ v[v._meta.pk.name], v._meta.pk ];
                }
            } catch (e) {}
            if (field) {
                if (include(['range', 'in'], lookup_type))
                    v = [v];
                v = field.get_db_prep_lookup(lookup_type, v);
                if (isinstance(v == Array))
                    v = v[0];
            }
            return v;
        };

        if (callable(value['as_sql'])) {
            var [sql, params] = value.as_sql();
            return new QueryWrapper(['(%s)'.subs(sql)], params);
        }

        if (include(['exact', 'gt', 'lt'], lookup_type))
            return [pk_trace(value)];
        if (include(['range', 'in'], lookup_type))
            return value.map(pk_trace);
        else if (lookup_type == 'isnull')
            return [];
        throw new TypeError("Related Field has invalid lookup: %s".subs(lookup_type));
    },

    _get_related_query_name: function(opts) {
        return this.rel.related_name || opts.object_name.toLowerCase();
    }
});

var SingleRelatedObjectDescriptor = type('SingleRelatedObjectDescriptor', object, {
    __init__: function(related){
        this.related = related;
        this.cache_name = '_%s_cache'.subs(related.get_accessor_name());
    },

    __get__: function(instance, instance_type) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("%s must be accessed via instance".subs(this.related.opts.object_name));

        var ret = instance[this.cache_name];
        if (!ret) {
            var key = '%s__pk'.subs(this.related.field.name);
            var params = {};
            params[key] = instance._get_pk_val();
            rel_obj = this.related.model._default_manager.get(params);
            instance[this.cache_name] = rel_obj;
            return rel_obj;
        }
        return ret;
    },

    __set__: function(instance, instance_type, value) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("%s must be accessed via instance".subs(this.related.opts.object_name));

        if ((!value) && this.related.field['null'] == false)
            throw new ValueError('Cannot assign Null: "%s.%s" does not allow null values.'.subs(instance._meta.object_name, this.related.get_accessor_name()));
        else if (value && !(value instanceof this.related.model))
            throw new ValueError('Cannot assign "%r": "%s.%s" must be a "%s" instance.'.subs(value, instance._meta.object_name, this.related.get_accessor_name(), this.related.opts.object_name))

        var key = this.related.field.rel.get_related_field();
        key = key.attname;
        value[key] = instance;

        instance[this.cache_name] = value;
        key = this.related.field.get_cache_name();
        value[key] = instance;
    }
});

var ReverseSingleRelatedObjectDescriptor = type('ReverseSingleRelatedObjectDescriptor', [ object ], {
    __init__: function(field_with_rel) {
        this.field = field_with_rel;
    },

    __get__: function(instance, instance_type) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("%s must be accessed via instance".subs(this.field.name));
        var cache_name = this.field.get_cache_name();

        var ret = instance[cache_name];
        if (!ret) {
            var val = instance[this.field.attname];
            if (!val) {
            if (this.field['null'])
                return null;
            throw new this.field.rel.to.DoesNotExist(this.field.attname);
            }
            var other_field = this.field.rel.get_related_field();
            if (other_field.rel)
                var key = '%s__pk'.subs(this.field.rel.field_name);
            else
                var key = '%s__exact'.subs(this.field.rel.field_name);
            var params = {};
            params[key] = val;
            var rel_mgr = this.field.rel.to._default_manager;
            var rel_obj = null;
            if (rel_mgr['use_for_related_fields'])
                rel_obj = rel_mgr.get(params);
            else
                rel_obj = new QuerySet(this.field.rel.to).get(params);
            instance[cache_name] = rel_obj;
            return rel_obj;
        }
        return ret;
    },

    __set__: function(instance, instance_type, value) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("%s must be accessed via instance".subs(this.field.name));

        if (!value && this.field['null'] == false)
            throw new ValueError('Cannot assign null: "%s.%s" does not allow null values.'.subs(instance._meta.object_name, this.field.name));
        else if (value && !(value instanceof this.field.rel.to))
            throw new ValueError('Cannot assign "%s": "%s.%s" must be a "%s" instance.'.subs(value, instance._meta.object_name, this.field.name, this.field.rel.to._meta.object_name));

        var key = this.field.rel.get_related_field();
        key = key.attname;
        var val = value[key] || null;

        instance[this.field.attname] = val;
        key = this.field.get_cache_name()
        instance[key] = value;
    }
});

var ForeignRelatedObjectsDescriptor = type('ForeignRelatedObjectsDescriptor', [ object ], {

    __init__: function(related){
        this.related = related;
    },

    __get__: function(instance, instance_type) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("Manager must be accessed via instance");

        rel_field = this.related.field;
        rel_model = this.related.model;
        superclass = this.related.model._default_manager.constructor;

        var RelatedManager = type('RelatedManager', [ superclass ], {
            get_query_set: function() {
                return super(superclass, this).get_query_set().filter(this.core_filters);
            },

            add: function() {
            	var arg = new Arguments(arguments);
            	var objs = arg.args; 
                for each (var obj in objs) {
                    obj[rel_field.name] = instance;
                    obj.save();
                }
            },

            create: function() {
            	var arg = new Arguments(arguments);
            	var kwargs = arg.kwargs;
                var key = rel_field.name;
                kwargs[key] = instance;
                return super(superclass, this).create(kwargs);
            },

            get_or_create: function() {
            	var arg = new Arguments(arguments);
            	var kwargs = arg.kwargs;
                var key = rel_field.name;
                kwargs[key] = instance;
                return super(superclass, this).get_or_create(kwargs);
            }
        });
        RelatedManager.prototype.add.alters_data = true;
        RelatedManager.prototype.create.alters_data = true;
        RelatedManager.prototype.get_or_create.alters_data = true;

        if (rel_field['null']) {
            RelatedManager.prototype['remove'] = function remove() {
            	var arg = new Arguments(arguments);
            	var objs = arg.args;
            	var key = rel_field.rel.get_related_field().attname;
                var val = instance[key];
                for each (var obj in objs) {
                if (obj[rel_field.attname] == val){
                    obj[rel_field.name] = null;
                    obj.save();
                }
                else{
                    throw new rel_field.rel.to.DoesNotExist("%s is not related to %r.".subs(obj, instance));
                }
                }
            }

            RelatedManager.prototype['clear'] = function clear() {
                for (var obj in this.all()) {
                obj[rel_field.name] = null;
                obj.save();
                }
            }
            RelatedManager.prototype.remove.alters_data = true
            RelatedManager.prototype.clear.alters_data = true;
        }

        manager = new RelatedManager();
        attname = rel_field.rel.get_related_field().name;
        var key = '%s__%s'.subs(rel_field.name, attname);
        manager.core_filters = {},
        manager.core_filters[key] = instance[attname];
        manager.model = this.related.model;

        return manager;
    },

    __set__: function(instance, instance_type, value) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("Manager must be accessed via instance");

        var manager = this.__get__(instance, instance_type);
        if (this.related.field['null'])
            manager.clear();
        manager.add.apply(manager, value);
    }
});

/*
    * Creates a manager that subclasses 'superclass' (which is a Manager)
    * and adds behavior for many-to-many related objects.
    */
function create_many_related_manager(superclass, through) {
    through = through || false;
    var ManyRelatedManager = type('ManyRelatedManager', [ superclass ], {
        __init__: function(model, core_filters, instance, symmetrical, join_table, source_col_name, target_col_name) {
            super(superclass, this).__init__();
            this.core_filters = core_filters || null;
            this.model = model || null;
            this.symmetrical = symmetrical || null;
            this.instance = instance || null;
            this.join_table = join_table || null;
            this.source_col_name = source_col_name || null;
            this.target_col_name = target_col_name || null;
            this.through = through || null;
            this._pk_val = this.instance._get_pk_val()
            if (!this._pk_val)
            throw new ValueError("%s instance needs to have a primary key value before a many-to-many relationship can be used." .subs(instance.constructor.__name__));
        },

        get_query_set: function() {
            return super(superclass, this).get_query_set()._next_is_sticky().filter(this.core_filters);
        },

        clear: function() {
            this._clear_items(this.source_col_name);
            // If this is a symmetrical m2m relation to self, clear the mirror entry in the m2m table
            if (this.symmetrical)
            this._clear_items(this.target_col_name);
        },

        create: function() {
        	var arg = new Arguments(arguments);
        	var kwargs = arg.kwargs;
            // This check needs to be done here, since we can't later remove this
            // from the method lookup table, as we do with add and remove.
            if (through)
            throw new AttributeError("Cannot use create() on a ManyToManyField which specifies an intermediary model. Use %s's Manager instead.".subs(through));
            new_obj = super(superclass, this).create(kwargs);
            this.add(new_obj);
            return new_obj;
        },

        get_or_create: function() {
        	var arg = new Arguments(arguments);
        	var kwargs = arg.kwargs;
            var [obj, created] = super(superclass, this).get_or_create(kwargs);
            // We only need to add() if created because if we got an object back
            // from get() then the relationship already exists.
            if (created)
            this.add(obj);
            return [obj, created];
        },

        _add_items: function(source_col_name, target_col_name) {
            // join_table: name of the m2m link table
            // source_col_name: the PK colname in join_table for the source object
            // target_col_name: the PK colname in join_table for the target object
            // objs - objects to add. Either object instances, or primary keys of object instances.

            var arg = new Arguments(arguments);
            var objs = arg.args;
            // If there aren't any objects, there is nothing to do.
            if (bool(objs)) {
                // Check that all the objects are of the right type
                var new_ids = new Set();
                for each (var obj in objs) {
                    if (obj instanceof this.model)
                        new_ids.add(obj._get_pk_val());
                    else
                        new_ids.add(obj);
                }
                // Add the newly created or already existing objects to the join table.
                // First find out which items are already added, to avoid adding them twice
                var cursor = connection.cursor();
                cursor.execute("SELECT %s FROM %s WHERE %s = %%s AND %s IN (%s)".subs( target_col_name, this.join_table, source_col_name, target_col_name, '%s'.times(new_ids.elements.length, ', ')), [this._pk_val].concat(new_ids.elements));
                var existing_ids = new Set([row[0] for each (row in cursor.fetchall())]);

                // Add the ones that aren't there already
                for (var obj_id in (new_ids.difference(existing_ids)))
                    cursor.execute("INSERT INTO %s (%s, %s) VALUES (%%s, %%s)".subs(this.join_table, source_col_name, target_col_name), [this._pk_val, obj_id]);
                //transaction.commit_unless_managed();
            }
        },

        _remove_items: function(source_col_name, target_col_name) {
            // source_col_name: the PK colname in join_table for the source object
            // target_col_name: the PK colname in join_table for the target object
            // objs - objects to remove

            var arg = new Arguments(arguments);
            var objs = arg.args;
            // If there aren't any objects, there is nothing to do.
            if (bool(objs)) {
            // Check that all the objects are of the right type
            old_ids = new Set();
            for (var obj in objs) {
                if (obj instanceof this.model)
                    old_ids.add(obj._get_pk_val());
                else
                    old_ids.add(obj);
            }
            // Remove the specified objects from the join table
            var cursor = connection.cursor();
            cursor.execute("DELETE FROM %s WHERE %s = %%s AND %s IN (%s)".subs(this.join_table, source_col_name, target_col_name, '%s'.times(old_ids.elements.length, ', ')), [this._pk_val].concat(old_ids.elements));
            //transaction.commit_unless_managed();
            }
        },

        _clear_items: function(source_col_name) {
            // source_col_name: the PK colname in join_table for the source object
            var cursor = connection.cursor();
            cursor.execute("DELETE FROM %s WHERE %s = %%s".subs(this.join_table, source_col_name), [this._pk_val]);
            //transaction.commit_unless_managed();
        }
    });
    ManyRelatedManager.prototype.clear.alters_data = true;
    ManyRelatedManager.prototype.create.alters_data = true;
    ManyRelatedManager.prototype.get_or_create.alters_data = true;

    // If the ManyToMany relation has an intermediary model,
    // the add and remove methods do not exist.
    if (!through) {
        ManyRelatedManager.prototype['add'] = function() {
            var arg = new Arguments(arguments);
            var args = [this.source_col_name, this.target_col_name].concat(arg.args);
            this._add_items.apply(this, args);

            // If this is a symmetrical m2m relation to self, add the mirror entry in the m2m table
            if (this.symmetrical) {
                args = [this.target_col_name, this.source_col_name].concat(arg.args);
                this._add_items.apply(this, args);
            }
        }

	    ManyRelatedManager.prototype['remove'] = function() {
            var arg = new Arguments(arguments);
            var args = [this.source_col_name, this.target_col_name].concat(arg.args);
            this._remove_items.apply(this, args);

            // If this is a symmetrical m2m relation to self, remove the mirror entry in the m2m table
            if (this.symmetrical)  {
                args = [this.target_col_name, this.source_col_name].concat(arg.args);
                this._remove_items.apply(this, args);
            }
        }
        ManyRelatedManager.prototype.add.alters_data = true;
        ManyRelatedManager.prototype.remove.alters_data = true;
    }
    return ManyRelatedManager;
}

var ManyRelatedObjectsDescriptor = type('ManyRelatedObjectsDescriptor', [ object ], {
    // This class provides the functionality that makes the related-object
    // managers available as attributes on a model class, for fields that have
    // multiple "remote" values and have a ManyToManyField pointed at them by
    // some other model (rather than having a ManyToManyField themselves).
    // In the example "publication.article_set", the article_set attribute is a
    // ManyRelatedObjectsDescriptor instance.
    __init__: function(related) {
        this.related = related;
    },

    __get__: function(instance, instance_type) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("Manager must be accessed via instance");

        // Dynamically create a class that subclasses the related
        // model's default manager.
        var rel_model = this.related.model;
        var superclass = rel_model._default_manager.constructor;
        var RelatedManager = create_many_related_manager(superclass, this.related.field.rel.through);

        var qn = connection.ops.quote_name;
        //function(model, core_filters, instance, symmetrical, join_table, source_col_name, target_col_name)
        var key = '%s__pk'.subs(this.related.field.name);
        var params = {};
        params[key] = instance._get_pk_val();
        var manager = new RelatedManager(
            rel_model,
            params,
            instance,
            false,
            qn(this.related.field.m2m_db_table()),
            qn(this.related.field.m2m_reverse_name()),
            qn(this.related.field.m2m_column_name())
        );

        return manager;
    },

    __set__: function(instance, instance_type, value) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("Manager must be accessed via instance");

        var through = this.related.field.rel['through'];
        if (through)
            throw new AttributeError("Cannot set values on a ManyToManyField which specifies an intermediary model. Use %s's Manager instead.".subs(through));

        var manager = this.__get__(instance, instance_type);
        manager.clear();
        manager.add.apply(manager, value);
    }
});

var ReverseManyRelatedObjectsDescriptor = type('ReverseManyRelatedObjectsDescriptor', [ object ], {
    // This class provides the functionality that makes the related-object
    // managers available as attributes on a model class, for fields that have
    // multiple "remote" values and have a ManyToManyField defined in their
    // model (rather than having another model pointed *at* them).
    // In the example "article.publications", the publications attribute is a
    // ReverseManyRelatedObjectsDescriptor instance.
    __init__: function(m2m_field) {
        this.field = m2m_field;
    },
    
    __get__: function(instance, instance_type) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("Manager must be accessed via instance");

        // Dynamically create a class that subclasses the related
        // model's default manager.
        var rel_model = this.field.rel.to;
        var superclass = rel_model._default_manager.constructor;
        var RelatedManager = create_many_related_manager(superclass, this.field.rel.through);

        var qn = connection.ops.quote_name;
        var key = '%s__pk'.subs(this.field.related_query_name());
        //function(model, core_filters, instance, symmetrical, join_table, source_col_name, target_col_name)
        var params = {};
        params[key] = instance._get_pk_val();
        var manager = new RelatedManager(
            rel_model,
            params,
            instance,
            (this.field.rel.symmetrical && instance.constructor == rel_model),
            qn(this.field.m2m_db_table()),
            qn(this.field.m2m_column_name()),
            qn(this.field.m2m_reverse_name())
        );

        return manager;
    },

    __set__: function(instance, instance_type, value) {
        if (!isinstance(instance, instance_type))
            throw new AttributeError("Manager must be accessed via instance");

        var through = this.field.rel['through'];
        if (through)
            throw new AttributeError("Cannot set values on a ManyToManyField which specifies an intermediary model.  Use %s's Manager instead.".subs(through));

        var manager = this.__get__(instance, instance_type);
        manager.clear();
        manager.add.apply(manager, value);
    }
});

var ManyToOneRel = type('ManyToOneRel', [ object ], {

    __init__: function(to, field_name) {
        var arg = new Arguments(arguments, {related_name: null, limit_choices_to: {}, lookup_overrides: {}, parent_link: false});

        if (!to._meta)
            assert (isinstance(to, String), "'to' must be either a model, a model name or the string %r".subs(RECURSIVE_RELATIONSHIP_CONSTANT));
        this.to = to;
        this.field_name = field_name;
        this.related_name = arg.kwargs['related_name'];
        this.limit_choices_to = arg.kwargs['limit_choices_to'];
        this.lookup_overrides = arg.kwargs['lookup_overrides'];
        this.parent_link = arg.kwargs['parent_link'];
        this.multiple = true;
    },

    /*
	* Returns the Field in the 'to' object to which this relationship is tied.
	*/
    get_related_field: function() {
        var data = this.to._meta.get_field_by_name(this.field_name);
        if (!data[2])
            throw new FieldDoesNotExist("No related field named '%s'".subs(this.field_name));
        return data[0];
    }
});

var OneToOneRel = type('OneToOneRel', [ ManyToOneRel ], {
    __init__: function(to, field_name) {
        var arg = new Arguments(arguments, {related_name: null, limit_choices_to: null, lookup_overrides: null, parent_link: false});

        super(ManyToOneRel, this).__init__(to, field_name, arg.kwargs);
        this.multiple = false;
    }
});

var ManyToManyRel = type('ManyToManyRel', [ object ], {
    __init__: function(to) {
        this.to = to;
        var arg = new Arguments(arguments, {related_name:null, limit_choices_to:{}, symmetrical:true, through: null});
        this.related_name = arg.kwargs['related_name'];
        this.limit_choices_to = arg.kwargs['limit_choices_to'];
        this.symmetrical = arg.kwargs['symmetrical'];
        this.through = arg.kwargs['through'];
        this.multiple = true;
    }
});

var ForeignKey = type('ForeignKey', RelatedField, {
    empty_strings_allowed:false,
    __init__: function(to) {
        var arg = new Arguments(arguments, {to_field:null, rel_class:ManyToOneRel, verbose_name: null});
        var to_field = null, rel_class = arg.kwargs['rel_class'];

        if (!isundefined(to._meta)) {
            var to_name = to._meta.object_name.toLowerCase();
            assert (!to._meta['abstract'], "cannot define a relation with abstract class %s".subs(to._meta.object_name));
            to_field = arg.kwargs['to_field'] || to._meta.pk.name;
        } else {
            assert(isinstance(to, String), '%s is invalid. First parameter to ForeignKey must be either a model, a model name, or the string %s'.subs(to, RECURSIVE_RELATIONSHIP_CONSTANT));
        }

        arg.kwargs['rel'] = new rel_class(to, to_field, arg.kwargs);
        super(RelatedField, this).__init__(arg.kwargs);

        this.db_index = true;
    },

    get_attname: function() {
        return '%s_id'.subs(this.name);
    },

    get_validator_unique_lookup_type: function() {
        return '%s__%s__exact'.subs(this.name, this.rel.get_related_field().name);
    },

    /*
     * Here we check if the default value is an object and return the to_field if so.
     */
    get_default: function() {
        var field_default = super(RelatedField, this).get_default();
        if (field_default instanceof this.rel.to)
            return field_default[this.rel.get_related_field().attname];
        return field_default;
    },

    get_db_prep_save: function(value) {
        if (value === '' || value == null || typeof(value) === 'undefined')
            return null;
        else
            return this.rel.get_related_field().get_db_prep_save(value);
    },

    value_to_string: function(obj) {
        if (!obj) {
            // In required many-to-one fields with only one available choice,
            // select that one available choice. Note: For SelectFields
            // we have to check that the length of choices is *2*, not 1,
            // because SelectFields always have an initial "blank" value.
            if (!this.blank && this.choices) {
                choice_list = this.get_choices_default();
                if (choice_list.length == 2)
                    return choice_list[1][0];
            }
        }
        return this.value_to_string(obj);
    },

    contribute_to_class: function(cls, name) {
        //TODO: aca esta la parte chancha grosa de los __set__ y los __get__
        // a la clase le mando el objeto luego en la instanciacion hago los enlaces
        super(RelatedField, this).contribute_to_class(cls, name);
        var frod = new ReverseSingleRelatedObjectDescriptor(this);
        var attr = this.name;
        cls.prototype.__defineGetter__(attr, function(){ return frod.__get__(this, this.constructor); });
        cls.prototype.__defineSetter__(attr, function(value){ return frod.__set__(this, this.constructor, value); });
        if (type(this.rel.to) == String)
            var target = this.rel.to;
        else
            var target = this.rel.to._meta.db_table
        cls._meta.duplicate_targets[this.column] = [target, "o2m"];
    },

    contribute_to_related_class: function(cls, related) {
        //TODO: validar que tiene que ser de instancia y no de clase o modelo en los manager
        var frod = new ForeignRelatedObjectsDescriptor(related);
        var attr = related.get_accessor_name();
        cls.prototype.__defineGetter__(attr, function(){ return frod.__get__(this, this.constructor); });
        cls.prototype.__defineSetter__(attr, function(value){ return frod.__set__(this, this.constructor, value); });
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {
            form_class: forms.ModelChoiceField,
            queryset: this.rel.to._default_manager.complex_filter(this.rel.limit_choices_to),
            to_field_name: this.rel.field_name
        }
        extend(defaults, arg.kwargs);
        return super(RelatedField, this).formfield(defaults);
    },

    db_type: function() {
        // The database column type of a ForeignKey is the column type
        // of the field to which it points. An exception is if the ForeignKey
        // points to an AutoField/PositiveIntegerField/PositiveSmallIntegerField,
        // in which case the column type is simply that of an IntegerField.
        // If the database needs similar types for key fields however, the only
        // thing we can do is making AutoField an IntegerField.
        var rel_field = this.rel.get_related_field();
        if (isinstance(rel_field, AutoField) || (!connection.features.related_fields_match_type && (isinstance(rel_field, PositiveIntegerField) || isinstance(rel_field, PositiveSmallIntegerField))))
            return new IntegerField().db_type();
        return rel_field.db_type();
    }
});

var OneToOneField = type('OneToOneField', [ ForeignKey ], {
    __init__: function __init__(to, to_field) {
        var arg = new Arguments(arguments);
        arg.kwargs['unique'] = true;
        super(ForeignKey, this).__init__(to, to_field, OneToOneRel, arg.kwargs);
    },

    contribute_to_related_class: function(cls, related) {
        var srod = new SingleRelatedObjectDescriptor(related);
        var attr = related.get_accessor_name();
        cls.prototype.__defineGetter__(attr, function(){ return srod.__get__(this, this.constructor); });
        cls.prototype.__defineSetter__(attr, function(value){ return srod.__set__(this, this.constructor, value); });
        if (!cls._meta.one_to_one_field)
            cls._meta.one_to_one_field = this;
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        if (this.rel.parent_link)
            return null;
        return super(ForeignKey, this).formfield(arg.kwargs);
    }
});

var ManyToManyField = type('ManyToManyField', [ RelatedField ], {
    __init__: function(to) {

        var arg = new Arguments(arguments, {'verbose_name': null});
        var to_field = null, rel_class = arg.kwargs['rel_class'];

        try {
            assert (!to._meta['abstract'], "cannot define a relation with abstract class %s".subs(to._meta.object_name));
        } catch (e if e instanceof AttributeError ) {
            assert(type(to) == String, "%s is invalid. First parameter to ForeignKey must be either a model, a model name, or the string %s".subs(to, RECURSIVE_RELATIONSHIP_CONSTANT));
        }
        arg.kwargs['rel'] = new ManyToManyRel(to, arg.kwargs);

        this.db_table = arg.kwargs['db_table'] || null;

        if (arg.kwargs['rel'].through) {
            this.creates_table = false;
            assert (!this.db_table, "Cannot specify a db_table if an intermediary model is used.");
        } else {
            this.creates_table = true;
        }

        super(RelatedField, this).__init__(arg.kwargs);

        var msg = 'Hold down "Control", or "Command" on a Mac, to select more than one.';
        this.help_text = this.help_text + ' ' + msg;
    },

    get_choices_default: function() {
        return super(RelatedField, this).get_choices_default();
    },

    /*
     * Function that can be curried to provide the m2m table name for this relation
     */
    _get_m2m_db_table: function(opts) {
        if (this.rel.through)
            return this.rel.through_model._meta.db_table;
        else if (this.db_table)
            return this.db_table
        else
            return '%s_%s'.subs(opts.db_table, this.name);
    },

    /*
     * Function that can be curried to provide the source column name for the m2m table
     */
    _get_m2m_column_name: function(related) {
        if (this._m2m_column_name_cache) {
            return this._m2m_column_name_cache;
        } else {
            if (this.rel.through) {
            for (var f in this.rel.through_model._meta.fields)
                if (f['rel'] && f.rel && f.rel.to == related.model) {
                    this._m2m_column_name_cache = f.column;
                    break;
                }
            }
            // If this is an m2m relation to self, avoid the inevitable name clash
            else if (related.model == related.parent_model) {
                this._m2m_column_name_cache = 'from_' + related.model._meta.object_name.toLowerCase() + '_id';
            } else {
                this._m2m_column_name_cache = related.model._meta.object_name.toLowerCase() + '_id';
            }

            // Return the newly cached value
            return this._m2m_column_name_cache;
        }
    },

    /*
     * Function that can be curried to provide the related column name for the m2m table
     */
    _get_m2m_reverse_name: function(related) {

        if (this._m2m_reverse_name_cache) {
            return this._m2m_reverse_name_cache;
        } else {
            if (this.rel.through) {
                found = false;
                for (var f in this.rel.through_model._meta.fields) {
                    if (f['rel'] && f.rel && f.rel.to == related.parent_model) {
                        if (related.model == related.parent_model) {
                            // If this is an m2m-intermediate to self,
                            // the first foreign key you find will be
                            // the source column. Keep searching for
                            // the second foreign key.
                            if (found) {
                                this._m2m_reverse_name_cache = f.column;
                                break;
                            } else {
                                found = true;
                            }
                        } else {
                            this._m2m_reverse_name_cache = f.column;
                            break;
                        }
                    }
                }
            }
            // If this is an m2m relation to self, avoid the inevitable name clash
            else if (related.model == related.parent_model) {
                this._m2m_reverse_name_cache = 'to_' + related.parent_model._meta.object_name.toLowerCase() + '_id';
            } else {
                this._m2m_reverse_name_cache = related.parent_model._meta.object_name.toLowerCase() + '_id';
            }
            // Return the newly cached value
            return this._m2m_reverse_name_cache;
        }
    },

    /*
     * Validates that the value is a valid list of foreign keys
     */
    isValidIDList: function(field_data, all_data) {
        mod = this.rel.to;
        try {
            pks = field_data.split(',').map(function(e) {
            var n = Number(e);
            if (isNaN(n))
                throw new ValueError(e);
            return e;
            });
        } catch (e if e instanceof ValueError) {
            // the CommaSeparatedIntegerField validator will catch this error
            return;
        }
        objects = mod._default_manager.in_bulk.apply(this, pks);
        if (objects.length != pks.length) {
            badkeys = [k for (k in pks) if (!include(objects, k))];
            throw new ValidationError(
            "Please enter valid %(self)s IDs. The value %(value)r is invalid.Please enter valid %(self)s IDs. The values %(value)r are invalid.");
        }
    },

    value_to_string: function(obj) {
        var data = '';
        if (obj) {
            qs = getattr(obj, this.name).all();
            data = [instance._get_pk_val() for (instance in qs)];
        } else {
            // In required many-to-many fields with only one available choice,
            // select that one available choice.
            if (!this.blank) {
            choices_list = this.get_choices_default();
            if (choices_list.length == 1)
                data = [choices_list[0][0]];
            }
        }
        return data;
    },

    contribute_to_class: function(cls, name) {
        // To support multiple relations to self, it's useful to have a non-None
        // related name on symmetrical relations for internal reasons. The
        // concept doesn't make a lot of sense externally ("you want me to
        // specify *what* on my non-reversible relation?!"), so we set it up
        // automatically. The funky name reduces the chance of an accidental
        // clash.
        if (this.rel.symmetrical && this.rel.to == "this" && !this.rel.related_name)
            this.rel.related_name = "%s_rel_+".subs(name);

        super(RelatedField, this).contribute_to_class(cls, name);
        // Add the descriptor for the m2m relation
        var rmrod = new ReverseManyRelatedObjectsDescriptor(this);
        var attr = this.name;
        cls.prototype.__defineGetter__(attr, function(){ return rmrod.__get__(this, this.constructor); });
        cls.prototype.__defineSetter__(attr, function(value){ return rmrod.__set__(this, this.constructor, value); });

        // Set up the accessor for the m2m table name for the relation
        this.m2m_db_table = curry(this._get_m2m_db_table, cls._meta);

        // Populate some necessary rel arguments so that cross-app relations
        // work correctly.
        if (this.rel.through && type(this.rel.through) == String) {
            function resolve_through_model(field, model, cls) {
            field.rel.through_model = model;
            }
            add_lazy_relation(cls, this, this.rel.through, resolve_through_model);
        }
        else if (this.rel.through) {
            this.rel.through_model = this.rel.through;
            this.rel.through = this.rel.through._meta.object_name;
        }

        if (this.rel.to && type(this.rel.to) == String)
            var target = this.rel.to;
        else
            var target = this.rel.to._meta.db_table;
        cls._meta.duplicate_targets[this.column] = [target, "m2m"]
    },

    contribute_to_related_class: function(cls, related) {
        // m2m relations to self do not have a ManyRelatedObjectsDescriptor,
        // as it would be redundant - unless the field is non-symmetrical.
        if (related.model != related.parent_model || !this.rel.symmetrical) {
            // Add the descriptor for the m2m relation
            var mrod = new ManyRelatedObjectsDescriptor(related);
            var attr = related.get_accessor_name();
            cls.prototype.__defineGetter__(attr, function(){ return mrod.__get__(this, this.constructor); });
            cls.prototype.__defineSetter__(attr, function(value){ return mrod.__set__(this, this.constructor, value); });
        }

        // Set up the accessors for the column names on the m2m table
        this.m2m_column_name = curry(this._get_m2m_column_name, related);
        this.m2m_reverse_name = curry(this._get_m2m_reverse_name, related);
    },

    set_attributes_from_rel: function() {},

    /*
     * Returns the value of this field in the given model instance.
     */
    value_from_object: function(obj) {
        return obj[this.attname].all();
    },

    save_form_data: function(instance, data) {
        instance[this.attname] = data;
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {
            form_class: forms.ModelMultipleChoiceField,
            queryset: this.rel.to._default_manager.complex_filter(this.rel.limit_choices_to)
        };
        extend(defaults, arg.kwargs);
        // If initial is passed in, it's a list of related objects, but the
        // MultipleChoiceField takes a list of IDs.
        if (defaults['initial'])
            defaults['initial'] = [i._get_pk_val() for each (i in defaults['initial'])];
        return super(RelatedField, this).formfield(defaults);
    },

    db_type: function() {
        // A ManyToManyField is not represented by a single column,
        // so return None.
        return null;
    }
});

publish({
    RelatedField: RelatedField,
    SingleRelatedObjectDescriptor: SingleRelatedObjectDescriptor,
    ReverseSingleRelatedObjectDescriptor: ReverseSingleRelatedObjectDescriptor,
    ForeignRelatedObjectsDescriptor: ForeignRelatedObjectsDescriptor,
    ManyRelatedObjectsDescriptor: ManyRelatedObjectsDescriptor,
    ReverseManyRelatedObjectsDescriptor: ReverseManyRelatedObjectsDescriptor,
    ManyToOneRel: ManyToOneRel,
    OneToOneRel: OneToOneRel,
    ManyToManyRel: ManyToManyRel,
    ForeignKey: ForeignKey,
    OneToOneField: OneToOneField,
    ManyToManyField: ManyToManyField 
});
