var LazyUser = type('LazyUser', [ object ], {
    __get__: function(request) {
        if (request._cached_user == null) { 
        	require('doff.contrib.auth.base', 'get_user');
        	request._cached_user = get_user(request);
        }
        return request._cached_user;
    },
    __set__: function(request, value) {
        request._cached_user = value;
    }
});

var AuthenticationMiddleware = type('AuthenticationMiddleware', [ object ], {
    process_request: function(request) {
		assert (hasattr(request, 'session'), "The Doff authentication middleware requires session middleware to be installed. Edit your MIDDLEWARE_CLASSES setting to insert 'doff.contrib.session.middleware.SessionMiddleware'.");
		var lu = new LazyUser();
        request.__defineGetter__('user', function() { return lu.__get__(request); });
        request.__defineSetter__('user', function(value) { return lu.__set__(request, value); });
        return null;
    }
});

publish({
    AuthenticationMiddleware: AuthenticationMiddleware
});