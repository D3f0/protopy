from django import template
from django.conf import settings

register = template.Library()

offline_template = '''
<script type="text/javascript;version=1.7" src="/%(OFFLINE_SUPPORT)s/protopy/protopy.js"></script>
<script type="text/javascript;version=1.7">
    require('doff.core.project', 'new_project');
    var %(PROJECT_PACKAGE)s = new_project('%(PROJECT_PACKAGE)s', '%(OFFLINE_SUPPORT)s');
    %(PROJECT_PACKAGE)s.bootstrap();
</script>
'''

def offline():
    offline_support = settings.OFFLINE_BASE
    project_package = 'blog'
    return offline_template % { 'OFFLINE_SUPPORT': offline_support, 
                                'PROJECT_PACKAGE': project_package
                              }

register.simple_tag(offline)