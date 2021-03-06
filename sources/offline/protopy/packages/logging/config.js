require('ajax');
require('event');
var logging = require('logging.base');
require('logging.handlers');

var hmc = null;

function _create_handlers(cp) {
    var hlist = cp['handlers'];
    if (!len(hlist))
        return {};
    var hlers = {}
    for (var hname in hlist) {
        var hand = hlist[hname];
        var klass = handlers[hand['class']];
        var args = hand['args'] || null;
        //Creamos el handler
        var h = new klass(args);
        if ('formatter' in hand)
            h.set_formatter(hand['formatter']);
        if ('level' in hand)
            h.set_level(logging.get_level(hand['level']));
        hlers[hname] = h;
    }
    return hlers;
}

function _install_loggers(cp, hlers) {
    var llist = cp['loggers'];
    // configure the root first
    var root = logging.root;
    var opts = llist['root'];
    if ('level' in opts)
        root.set_level(logging.get_level(opts['level']));
    root.clear_handlers();
    var hlist = opts['handlers'];
    if (len(hlist)) {
        hlist = hlist.split(',');
        for each (var hand in hlist)
            root.add_handler(hlers[hand.strip()]);
    }
    delete llist['root'];

    var existing = keys(root.manager.logger_dict);

    for (var lname in llist) {
        opts = llist[lname];
        var logger = logging.get_logger(lname);
        var index = existing.indexOf(lname);
        if (index >= 0)
            delete existing[index];
        logger.propagate = ('propagate' in opts)? opts['propagate'] : true;
        if ('level' in opts)
            logger.set_level(logging.get_level(opts['level']));
        logger.clear_handlers();
        logger.disabled = 0;
        var hlist = opts['handlers'];
        if (len(hlist)) {
            hlist = hlist.split(',');
            for each (var hand in hlist)
                logger.add_handler(hlers[hand.strip()]);
        }
    }
    //Disable any old loggers. There's no point deleting
    //them as other threads may continue to hold references
    //and by disabling them, you stop them doing any logging.
    for each (var lname in existing)
        root.manager.logger_dict[lname].disabled = 1;
}

function file_config(fname, defaults) {
    var config = defaults || {};
    var url_settings = fname;
    new ajax.Request(url_settings, {
        method: 'GET',
        asynchronous : false,
        'onSuccess': function onSuccess(transport) {
            var code = '(' + transport.responseText + ');';
            var logging_config = eval(code);
            config = extend(config, logging_config);
        },
        'onException': function onException(obj, exception){
            throw exception;
        },
        'onFailure': function onFailure(transport){
            throw new Exception('No logging file');
        }
    });

    var hlers = _create_handlers(config);
    _install_loggers(config, hlers);
}

publish({
    file_config: file_config
});