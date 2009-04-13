$L('sys');
$L('event');
$L('doff.core.exceptions');
$L('doff.core.urlresolvers');
$L('doff.core.http');

var elements = {
    'DEFAULT': function DEFAULT(request, obj) {
	if (type(obj) == String) {
	    //TODO: trabajar la cadena para tratar mas casos, ej, http://www.google.com, https://algo.com/ruta/recurso.js
	    request.pathname = obj;
	    request.method = 'get';
	}
	return request;
    },
    'form': function form(request, element) {
	//TODO: manejar merjor el acciont para ver para donde salen disparados, por si se van del dominio.
	var f = $Q(element);
	request.method = f.method;
	request.pathname = element.action.slice(len(request.build_absolute_uri()));
	request[f.method] = f.serialize();
	return request;
    },

    'a': function a(request, element) {
	request.pathname = element.pathname;
	request.hostname = element.hostname;
	request.protocol = element.protocol;
	request.method = 'get';
	return request;
    },
}

var Handler = type('Handler', [object], {
    handle: function handle(element) {
	var request = new http.HttpRequest();
	if (element.tagName) {
	    var name = element.tagName.toLowerCase();
	    if (callable(elements[name]))
		request = elements[name](request, element);
	    else 
		throw new NotImplementedError('%s not implemented'.subs(name));
	} else {
	    request = elements['DEFAULT'](request, element);
	}
	if (request.valid())
	    this._execute(request);
	return false;
    },

    _execute: function execute(request) {
        //Execute action
       $L('doff.core.project', 'get_settings');
	
        var settings = get_settings();
        // Get urlconf.
        var urlconf = settings.ROOT_URLCONF;

        var resolver = new urlresolvers.RegexURLResolver('^/', urlconf);
        try {
            var [callback, callback_args, callback_kwargs] = resolver.resolve(request.pathname);
            try {
		var args = [request];
		args = args.concat(callback_args);
		args.push(callback_kwargs);
                var response = callback.apply(this, args);
		//TODO: A better name
		response.render();
            } catch (e) {
                print(e);
	    }
        } catch (e) {
	    //Handle everything else, including SuspiciousOperation, etc.
            // Get the exception info now, in case another exception is thrown later.
            //exc_info = sys.exc_info();
            //receivers = event.send('got_request_exception', this.__class__, request);
            //return this.handle_uncaught_exception(request, resolver, exc_info);
	    print(e);
	}
    },

    handle_uncaught_exception: function handle_uncaught_exception(request, resolver, exc_info) {
	/*
        Processing for any otherwise uncaught exceptions (those that will
        generate HTTP 500 responses). Can be overridden by subclasses who want
        customised 500 handling.

        Be *very* careful when overriding this because the error could be
        caused by anything, so assuming something like the database is always
        available would be an error.
        */
        /*
	from django.conf import settings
        from django.core.mail import mail_admins

        if settings.DEBUG_PROPAGATE_EXCEPTIONS:
            raise

        if settings.DEBUG:
            from django.views import debug
            return debug.technical_500_response(request, *exc_info)

        # When DEBUG is False, send an error message to the admins.
        subject = 'Error (%s IP): %s' % ((request.META.get('REMOTE_ADDR') in settings.INTERNAL_IPS and 'internal' or 'EXTERNAL'), request.path)
        try:
            request_repr = repr(request)
        except:
            request_repr = "Request repr() unavailable"
        message = "%s\n\n%s" % (self._get_traceback(exc_info), request_repr)
        mail_admins(subject, message, fail_silently=True)
        # Return an HttpResponse that displays a friendly error message.
        callback, param_dict = resolver.resolve500()
        return callback(request, **param_dict)
	*/
    },

    _get_traceback: function _get_traceback(exc_info) {
        //TODO: si tiene firebug usearlo para el traceback
	//Helper function to return the traceback as a string
        //import traceback
        //return '\n'.join(traceback.format_exception(*(exc_info or sys.exc_info())))
    },

    apply_response_fixes: function apply_response_fixes(request, response) {
        /*
        Applies each of the functions in self.response_fixes to the request and
        response, modifying the response in the process. Returns the new
        response.
        */
        /*for func in self.response_fixes:
            response = func(request, response)
        return response*/
    }
});

$P({Handler: Handler});