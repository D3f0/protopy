'''
Remote models for doff app
'''

from doffproj.blog.models import *
from djangoffline.remote import RemoteSite 
from django.db import models

#class TagRemote(RemoteModelProxy):
#    
#    p = models.DateField('Fecha de creacion')
#    
#    def dump(self):
#        user = get_user()
#        pass
#    
#    def sync(self, data):
#        raise NotImplementedError("No funca")
#    
#    class Meta:
#        model = Tag
#        exclude = ('fecha', )
#        
#
#class PostRemote(RemoteModelProxy):
#    class Meta:
#        model = Post



site = RemoteSite()