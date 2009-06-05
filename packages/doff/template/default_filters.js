require('doff.template.base', 'Variable', 'Library');
var register = new Library();

function capitalize(value){ 
    return value.capitalize(); 
}
register.filter(capitalize);

function join(value, arg) {
    return array(value).join(arg);
}
register.filter(join);

function slugify(value) {
    var badchars = ['á','é','í','ó','ú','ñ'];
    var goodchars = ['a','e','i','o','u','n'];
    for (var i = 0, length = badchars.length; i < length; i++)
        value = value.replace(badchars[i], goodchars[i], 'g');
    value = value.replace(/[^\w\s-]/g, '').strip().toLowerCase();
    return value.replace(/[-\s]+/g, '-');
}
register.filter(slugify);

function escape(value) {
    return value.escapeHTML();
}
register.filter(escape);

publish({
    register: register,
    slugify: slugify
});