if (!window.google || !window.google.gears) {
    alert('google is not defined');
    window.location.href = 'http://gears.google.com/';
}

var localServer = google.gears.factory.create('beta.localserver');

//TODO: Se puede explotar mucho mas este objeto
var ResourceStore = type ('ResourceStore', {
    _store: null,

    '__init__': function __init__(name, requiredCookie) {
	this._store = localServer.createStore(name, requiredCookie);
    },

    'delete': function delete() {
	localServer.removeStore(this.name, this.required_cookie);
    },

    get name(){
	return this._store.name;
    },
    
    get required_cookie(){
	return this._store.requiredCookie;
    },

    get enabled(){
	return this._store.enabled;
    },

    set enabled( value ){
	this._store.enabled = value;
    },
   
    capture: function(urlOrUrlArray, completionCallback) {
	return this._store.capture(urlOrUrlArray, completionCallback);
    },
    
    abort_capture: function(captureId) {
	this._store.abortCapture(captureId);
    },

    remove: function(url) {
	this._store.remove(url);
    },

    rename: function(srcUrl, destUrl) {
	this._store.rename(srcUrl, destUrl);
    },
    
    copy: function(srcUrl, destUrl) {
	this._store.copy(srcUrl, destUrl);
    },
    
    is_captured: function(url) {
	return this._store.isCaptured(url);
    },

    capture_blob: function(blob, url, optContentType) {
	this._store.captureBlob(blob, url, optContentType);
    },

    capture_file: function(fileInputElement, url) {
	this._store.captureFile(fileInputElement, url);
    },

    get_captured_file_name: function(url) {
	return this._store.getCapturedFileName(url);
    },

    get_header: function(url, name) {
	return this._store.getHeader(url, name);
    },

    get_all_headers: function(url) {
	return this._store.getAllHeaders(url);
    },

    get_as_blob: function(url) {
	return this._store.getAsBlob(url);
    },

    create_file_submitter: function() {
	return this._store.createFileSubmitter();
    }
});

$P({
    canServeLocally: localServer.canServeLocally,
    ResourceStore: ResourceStore,
    //ManagedResourceStore: ManagedResourceStore
});
