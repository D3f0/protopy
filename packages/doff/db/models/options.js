$D("doff.db.models.options");
    
$L('doff.conf', 'settings');
$L('doff.db.models.related', 'RelatedObject');
$L('doff.db.models.fields.related', 'ManyToManyRel');
$L('doff.db.models.fields', 'AutoField', 'FieldDoesNotExist');
$L('doff.db.models.fields.proxy', 'OrderWrt');
$L('doff.db.models.loading', 'get_models', 'app_cache_ready');

$L('doff.utils.datastructures', 'SortedDict');

// Calculate the verbose_name by converting from InitialCaps to "lowercase with spaces".
//TODO: Pasar los nombres de las clases
var get_verbose_name = function(class_name) { return class_name;};


var DEFAULT_NAMES = ['verbose_name', 'db_table', 'ordering', 'unique_together', 'permissions', 'get_latest_by',
                    'order_with_respect_to', 'app_label', 'db_tablespace',
                    'abstracto'];

var Options = type('Options', {
    '__init__': function __init__(meta, app_label) {
        this.local_fields = [];
        this.local_many_to_many = [];
        this.virtual_fields = [];
        this.module_name = null;
        this.verbose_name = null;
        this.verbose_name_plural = null;
        this.db_table = '';
        this.ordering = [];
        this.unique_together =  [];
        this.object_name = null;
        this.app_label = app_label || null;
        this.get_latest_by = null;
        this.order_with_respect_to = null;
        this.meta = meta;
        this.pk = null;
        this.has_auto_field = false;
        this.auto_field = null;
        this.one_to_one_field = null;
        this.abstracto = false;
        this.parents = new SortedDict();
        this.duplicate_targets = {};
        // Managers that have been inherited from abstract base classes. These are passed onto any children.
        this.abstract_managers = [];

    },

    '__str__': function __str__() {
        return "%s.%s".subs(this.app_label, this.module_name);
    },
    
    'contribute_to_class': function contribute_to_class(cls, name) {
        var connection = $L('doff.db', 'connection');
        var truncate_name = $L('doff.db.backends.util', 'truncate_name');
        
        cls._meta = this;
        this.installed = include(settings.INSTALLED_APPS, cls.__module__.replace(/\.models$/, ''));
        // First, construct the default values for these options.
        this.object_name = cls.__name__;
        this.module_name = this.object_name.toLowerCase();
        this.verbose_name = get_verbose_name(this.object_name);

        // Next, apply any overridden values from 'class Meta'.
        if (this.meta) {
            var meta_attrs = {};
            extend(meta_attrs, this.meta);
            for (name in this.meta) {
                // Ignore any private attributes that Django doesn't care about.
                // NOTE: We can't modify a dictionary's contents while looping
                // over it, so we loop over the *original* dictionary instead.
                if (name.starts_with('_'))
                    delete meta_attrs[name];
            }
            for each (attr_name in DEFAULT_NAMES) {
                if (attr_name in meta_attrs)
                    this[attr_name] = meta_attrs[attr_name];
                else if (this.meta[attr_name])
                    this[attr_name] = this.meta[attr_name];
            }
            // unique_together can be either a tuple of tuples, or a single
            // tuple of two strings. Normalize it to a tuple of tuples, so that
            // calling code can uniformly expect that.
            var ut = meta_attrs['unique_together'] || this['unique_together'];
            if (bool(ut) && type(ut[0]) == Array)
                ut = [ut];
            this['unique_together'] = ut;

            // verbose_name_plural is a special case because it uses a 's'
            // by default.
            this['verbose_name_plural'] = meta_attrs['verbose_name_plural'] || this.verbose_name + 's';
        } else {
            this.verbose_name_plural = this.verbose_name + 's';
        }
        delete this.meta;

        // If the db_table wasn't provided, use the app_label + module_name.
        if (!this.db_table)
            this.db_table = "%s_%s".subs(this.app_label, this.module_name);
            this.db_table = truncate_name(this.db_table, connection.ops.max_name_length());

        //For the instance
        cls.prototype._meta = this;
    },

    '_prepare': function _prepare(model) {
        if (this.order_with_respect_to) {
            this.order_with_respect_to = this.get_field(this.order_with_respect_to);
            this.ordering = ['_order'];
        } else {
            this.order_with_respect_to = null;
        }

        if (!this.pk) {
            if (bool(this.parents)) {
                // Promote the first parent link in lieu of adding yet another field.
                var field = this.parents.value_for_index(0);
                field.primary_key = true;
                this.setup_pk(field);
            } else {
                var auto = new AutoField({'verbose_name':'ID', 'primary_key':true, 'auto_created': true});
                model.add_to_class('id', auto);
            }
        }

        // Determine any sets of fields that are pointing to the same targets
        // (e.g. two ForeignKeys to the same remote model). The query
        // construction code needs to know this. At the end of this,
        // self.duplicate_targets will map each duplicate field column to the
        // columns it duplicates.
        var collections = {};
        for each (column in this.duplicate_targets) {
            var target = this.duplicate_targets[column];
            if (!collections[target])
                collections[target] = new Set();
            collections[target].add(column);
        }
        this.duplicate_targets = {};
        for each (elt in collections) {
            if (elt.length == 1)
                continue;
            for each (column in elt)
                this.duplicate_targets[column] = elt.difference(new Set([column]));
        }
    },

    'add_field': function add_field(field) {
        // Insert the given field in the order in which it was created, using
        // the "creation_counter" attribute of the field.
        // Move many-to-many related fields from self.fields into
        // self.many_to_many.
        if (field.rel && field.rel instanceof ManyToManyRel) {
            //TODO implementar bisect en base a __cmp__ y usar splice para insertar
            this.local_many_to_many.splice(bisect(this.local_many_to_many, field), 0, field);
            if (this['_m2m_cache'])
                delete this._m2m_cache;
        } else {
            this.local_fields.splice(bisect(this.local_fields, field), 0, field);
            this.setup_pk(field);
            if (this['_field_cache']) {
                delete this._field_cache;
                delete this._field_name_cache;
            }
        }

        if (this['_name_map'])
            delete self._name_map;
    },

    'add_virtual_field': function add_virtual_field(field) {
        this.virtual_fields.push(field);
    },

    'setup_pk': function setup_pk(field) {
        if (!this.pk && field.primary_key) {
            this.pk = field;
            field.serialize = false;
        }
    },

    /*
        * There are a few places where the untranslated verbose name is needed
        * (so that we get the same value regardless of currently active locale).
        */
    get verbose_name_raw() {
        return this.verbose_name;
    },

    /*
        * The getter for self.fields. This returns the list of field objects
        * available to this model (including through parent models).
        * Callers are not permitted to modify this list, since it's a reference
        * this instance (not a copy).
        */
    get fields() {
        if (!this._field_name_cache)
            this._fill_fields_cache();
        return this._field_name_cache;
    },

    /*
        * Returns a sequence of (field, model) pairs forclasses all fields. The "model"
        * element is None for fields on the current model. Mostly of use when
        * constructing queries so that we know which model a field belongs to.
        */
    'get_fields_with_model': function get_fields_with_model() {
        if (!this._field_cache)
            this._fill_fields_cache();
        return this._field_cache;
    },

    '_fill_fields_cache': function _fill_fields_cache() {
        var cache = [];
        for each (parent in this.parents.keys()) {
            for each (var [field, model] in parent._meta.get_fields_with_model()) {
                if (model)
                    cache.push([field, model]);
                else
                    cache.push([field, parent]);
            }
        }
        var fields = [[f, null] for each (f in this.local_fields)];
        cache = cache.concat(fields);
        this._field_cache = cache;
        this._field_name_cache = [x for each ([x, y] in cache)];
    },

    get many_to_many() {
        if (!this._m2m_cache)
            this._fill_m2m_cache();
        return this._m2m_cache.keys();
    },
    
    /*
        * The many-to-many version of get_fields_with_model().
        */
    'get_m2m_with_model': function get_m2m_with_model() {
        if (!this._m2m_cache)
            this._fill_m2m_cache();
        return this._m2m_cache.items();
    },

    '_fill_m2m_cache': function _fill_m2m_cache() {
        var cache = new SortedDict();
        for each (parent in this.parents.keys()) {
            for each (var [field, model] in parent._meta.get_m2m_with_model()) {
                if (model)
                    cache.set(field, model);
                else
                    cache.set(field, parent);
            }
        }
        for each (field in this.local_many_to_many)
            cache.set(field, null);
        this._m2m_cache = cache;
    },

    /*
        * Returns the requested field by name. Raises FieldDoesNotExist on error.
        */
    'get_field': function get_field(name, many_to_many) {
        var many_to_many = many_to_many || true;
        var to_search = many_to_many && (this.fields.concat(this.many_to_many)) || this.fields;
        for each (f in to_search)
            if (f.name == name)
                return f;
        throw new FieldDoesNotExist('%s has no field named %s'.subs(this.object_name, name));
    },

    /*
        * Returns the (field_object, model, direct, m2m), where field_object is
        the Field instance for the given name, model is the model containing
        this field (None for local fields), direct is True if the field exists
        on this model, and m2m is True for many-to-many relations. When
        'direct' is False, 'field_object' is the corresponding RelatedObject
        for this field (since the field doesn't have an instance associated
        with it).

        Uses a cache internally, so after the first access, this is very fast.
        */
    'get_field_by_name': function get_field_by_name(name) {
        var field = null;
        if (!this._name_map) {
            var cache = this.init_name_map();
            field = cache[name];
        } else {
            field = this._name_map[name];
        }
        if (!field)
            throw new FieldDoesNotExist('%s has no field named %s'.subs(this.object_name, name));
        return field;
    },

    /*
        * Returns a list of all field names that are possible for this model
        (including reverse relation names). This is used for pretty printing
        debugging output (a list of choices), so any internal-only field names
        are not included.
        */
    'get_all_field_names': function get_all_field_names() {
        var cache = this._name_map;
        if (!cache)
            cache = this.init_name_map();
        var names = keys(cache);
        names.sort();
        // Internal-only names end with "+" (symmetrical m2m related names being the main example). Trim them.
        return [val for each (val in names) if (!val.ends_with('+'))];
    },

    /*
        * Initialises the field name -> field object mapping.
        */
    'init_name_map': function init_name_map() {
        var cache = {};
        // We intentionally handle related m2m objects first so that symmetrical
        // m2m accessor names can be overridden, if necessary.
        for each ([f, model] in this.get_all_related_m2m_objects_with_model())
            cache[f.field.related_query_name()] = [f, model, false, true];
        for each ([f, model] in this.get_all_related_objects_with_model())
            cache[f.field.related_query_name()] = [f, model, false, false];
        for each ([f, model] in this.get_m2m_with_model())
            cache[f.name] = [f, model, true, true];
        for each ([f, model] in this.get_fields_with_model())
            cache[f.name] = [f, model, true, false];
        if (this.order_with_respect_to)
            cache['_order'] = [new OrderWrt(), null, true, false];
        if (app_cache_ready())
            this._name_map = cache;
        return cache;
    },

    'get_all_related_objects': function get_all_related_objects(local_only) {
        if (!this._related_objects_cache)
            this._fill_related_objects_cache();
        if (local_only)
            return [k for each ([k, v] in this._related_objects_cache.items()) if (!v)]
        return this._related_objects_cache.keys();
    },

    /*
        * Returns a list of (related-object, model) pairs. Similar to get_fields_with_model().
        */
    'get_all_related_objects_with_model': function get_all_related_objects_with_model() {
        if (!this._related_objects_cache)
            this._fill_related_objects_cache();
        return this._related_objects_cache.items();
    },

    '_fill_related_objects_cache': function _fill_related_objects_cache() {
        var cache = new SortedDict();
        var parent_list = this.get_parent_list();
        for each (parent in this.parents)
            for each ([obj, model] in parent._meta.get_all_related_objects_with_model()) {
                if ((obj.field.creation_counter < 0 || obj.field.rel.parent_link) && !include(parent_list, obj.model))
                    continue;
                if (!model)
                    cache.set(obj, parent);
                else
                    cache.set(obj, model);
            }
        for each (klass in get_models())
            for each (f in klass._meta.local_fields)
                if (f.rel && !isstring(f.rel.to) && this == f.rel.to._meta)
                    cache.set(new RelatedObject(f.rel.to, klass, f), null);
        this._related_objects_cache = cache;
    },

    'get_all_related_many_to_many_objects': function get_all_related_many_to_many_objects(local_only) {
        var cache = this._related_many_to_many_cache;
        if (!cache)
            cache = this._fill_related_many_to_many_cache();
        if (local_only)
            return [k for each ([k, v] in cache.items()) if (!v)];
        return cache.keys();
    },

    /*
        * Returns a list of (related-m2m-object, model) pairs. Similar to get_fields_with_model().
        */
    'get_all_related_m2m_objects_with_model': function get_all_related_m2m_objects_with_model() {
        var cache = this._related_many_to_many_cache;
        if (!cache)
            cache = this._fill_related_many_to_many_cache();
        return cache.items();
    },

    '_fill_related_many_to_many_cache': function _fill_related_many_to_many_cache() {
        var cache = new SortedDict();
        var parent_list = this.get_parent_list();
        for each (parent in this.parents) {
            for each ([obj, model] in parent._meta.get_all_related_m2m_objects_with_model()) {
                if (obj.field.creation_counter < 0 && include(parent_list, obj.model))
                    continue;
                if (!model)
                    cache.set(obj, parent);
                else
                    cache.set(obj, model);
            }
        }
        for each (klass in get_models())
            for each (f in klass._meta.local_many_to_many)
                if (f.rel && !isstring(f.rel.to) && this == f.rel.to._meta)
                    cache.set(new RelatedObject(f.rel.to, klass, f), null);
        if (app_cache_ready())
            this._related_many_to_many_cache = cache;
        return cache;
    },

    /*
        * Returns a list of parent classes leading to 'model' (order from closet
        to most distant ancestor). This has to handle the case were 'model' is
        a granparent or even more distant relation.
        */
    'get_base_chain': function get_base_chain(model) {
        if (bool(this.parents))
            return;
        if (include(this.parents, model))
            return [model];
        for each (parent in this.parents)
            res = parent._meta.get_base_chain(model);
            if (res)
                res.push(0, parent);
                return res;
        throw new TypeError('%s is not an ancestor of this model'.subs(model._meta.module_name));
    },

    /*
        * Returns a list of all the ancestor of this model as a list. Useful for
        * determining if something is an ancestor, regardless of lineage.
        */
    'get_parent_list': function get_parent_list() {
        var result = new Set();
        for each (parent in this.parents) {
            result.add(parent);
            result.update(parent._meta.get_parent_list());
        }
        return result;
    },

    /*
        * Returns a list of Options objects that are ordered with respect to this object.
        */
    'get_ordered_objects': function get_ordered_objects() {
        
        if (!this['_ordered_objects']) {
            var objects = [];
            // TODO
            //for klass in get_models(get_app(self.app_label)):
            //    opts = klass._meta
            //    if opts.order_with_respect_to and opts.order_with_respect_to.rel \
            //        and self == opts.order_with_respect_to.rel.to._meta:
            //        objects.append(opts)
            this._ordered_objects = objects;
        }
        return this._ordered_objects;
    }
});

$P({ 'Options': Options });