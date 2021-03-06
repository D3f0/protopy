require('doff.core.exceptions', 'ImproperlyConfigured'),
require('doff.template.base', 'Template', 'Context', 'TemplateDoesNotExist', 'add_to_builtins');
require('doff.conf.settings', 'settings');
var logging = require('logging.base');

var logger = logging.get_logger(__name__);

/* defo:translate
 * Busca un template para cada uno de los cargadores de template definididos en settings
 * Si los cargadores no estan iniciados, los inicia, dejandolos dentro del proyecto
 */
var template_source_loaders = null;

function find_template_source(name, dirs) {
    if (!template_source_loaders) {
        var loaders = [];
        for each (var path in settings.TEMPLATE_LOADERS) {
            var i = path.lastIndexOf('.');
            var module = path.substring(0, i);
            var attr = path.substring(i + 1 , path.length);
            try {
                var mod = require(module);
            } catch (e) {
                throw new ImproperlyConfigured('Error importing template source loader %s: "%s"'.subs(module, e));
            }
            try {
                var loader = getattr(mod, attr);
            } catch (e if isinstance(e, AttributeError)) {
                throw new ImproperlyConfigured('Module "%s" does not define a "%s" callable template source loader'.subs(module, attr));
            }
            loaders.push(loader);
        }
        template_source_loaders = loaders;
    }
    for each (var loader in template_source_loaders) {
        try {
            var [source, display_name] = loader(name, dirs);
            logger.debug('Template: %s, Name: %s, Dirs: %s', display_name, name, dirs);
            return source;
        } catch (e if isinstance(e, TemplateDoesNotExist)) { }
    }
    throw new TemplateDoesNotExist(name);
}

/* defo:translate
 * Carga un template en base a su nombre ejemplo.html
 */
function get_template(template_name) {
    var source = find_template_source(template_name);
    return get_template_from_string(source, template_name);
}

function get_template_from_string(source, name) {
    return new Template(source, name);
}

function render_to_string(template_name, dictionary, context_instance) {
    var dictionary = dictionary || {};
    if (isinstance(template_name, Array))
        var t = select_template(template_name);
    else
        var t = get_template(template_name);
    if (context_instance)
        context_instance.update(dictionary);
    else
        context_instance = new Context(dictionary);
    return t.render(context_instance);
}

function select_template(template_name_list) {
    for each (var template_name in template_name_list) {
        try {
            return get_template(template_name);
        } catch (e if isinstance(e, TemplateDoesNotExist)) {}
    }
    throw new TemplateDoesNotExist(template_name_list.join(', '));
}

publish({ 
    find_template_source: find_template_source,
    get_template_from_string: get_template_from_string,
    get_template: get_template,
    render_to_string: render_to_string,
    select_template: select_template
});