{% load export_models %}
var models = require('doff.db.models.base');
require('doff.contrib.offline.models', 'RemoteModel', 'RemoteReadOnlyModel');
{% for name in apps %}require('{{site.name}}.{{name}}.models', '*');
{% endfor %}require('{{site.name}}.{{app}}.mixin');

{% for name, class, fields in models %}//Create Object
var mixed{{ name }} = extend(mixin.{{ name }} || {}, {
{% for field_name, arguments in fields.iteritems %}    {{ field_name }}: new models.{{ arguments|first }}({% get_model_definition app name arguments %}),
{% endfor %}});

//Create Model
var {{ name }} = type("{{ name }}", {{ class }}, mixed{{name}});

{% endfor %}publish({
{% for name, _ in models %}    {{ name }}: {{ name }}{% if not forloop.last %},{% endif %}
{% endfor %}});