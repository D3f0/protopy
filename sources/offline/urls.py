from django.conf.urls.defaults import *
from django.conf import settings
from django.db.models.loading import get_app
import os
import views
import sync

urlpatterns = patterns('',
    (r'^$', views.index, ),
    # TODO: Mejorar esto
    (r'^show_models/', views.export_model_proxy),
    (r'^list_templates/', views.list_templates, ), 
    (r'^sync', sync.rpc_handler),
    (r'^templates/(.*)', views.template_static_serve, ),
    # DMvH tests
    (r'^export/(?P<app_name>.*)/models.js$', views.get_app_remote_model, ),
    # WIP D3f0
    (r'^export_/(?P<app_name>.*)/models.js$', views.get_app_remote_model_, ),
    # Manifest test
    (r'^manifest.json', views.get_manifest),
    
    (r'^manifests/project.json', views.get_project_manifest, ),
    
    (r'^network_check', views.network_check), 
)

urlpatterns += patterns('offline.views',
    # Project
#    (r'manifests/project.json', 'dynamic_manifest_from_fs', 
#     {
#        'path': settings.OFFLINE_ROOT, 
#        'base_uri': '/%s/project' % settings.OFFLINE_BASE                               
#     }),
     
     # System
#     (r'manifests/system.json', 'dynamic_manifest_from_fs', 
#     {
#        'path': os.path.join( settings.OFFLINE_ROOT, '../protopy'), 
#        'base_uri': '/%s/' % settings.OFFLINE_BASE                               
#     }),
)



if settings.LOCAL_DEVELOPMENT:
    
    from os.path import abspath, dirname, join
    protopy_path = getattr(get_app('offline'), '__file__')
    protopy_path = join(abspath(dirname(protopy_path)), 'protopy')
    
    urlpatterns += patterns('django.views.static',
        (r'project/(?P<path>.*)', 'serve', {"document_root": settings.OFFLINE_ROOT,
                                            "show_indexes": True}),
        (r'protopy/(?P<path>.*)', 'serve', {"document_root": protopy_path,
                                            "show_indexes": True}),
    )
    
    # Databrowse
    from django.contrib import databrowse
    from django.db.models.loading import get_models
    map( databrowse.site.register, get_models())
    #databrowse.site.register(SomeModel)
    urlpatterns += patterns('',
        (r'^databrowse/(.*)', databrowse.site.root),
    )
    
    urlpatterns += patterns('offline.views',
        (r'manifests/system.json', 'dynamic_manifest_from_fs',
         {
            'path': protopy_path, 
            'base_uri': '/%s/protopy' % settings.OFFLINE_BASE                               
        }),
    )
    