$L('doff.conf.urls', '*');
$L('blog.views', 'index');

var urlpatterns = patterns('',
    // Example:
    ['^$', 'blog.apps.post.views.show_posts'],
    ['^blog/', include('blog.apps.post.urls')]
)

$P({ 'urlpatterns': urlpatterns });
