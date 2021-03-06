# -*- coding: utf-8 -*-
from django.db import models
'''
Models del blog
'''
class Tag(models.Model):
    slug = models.SlugField(help_text = 'Automatically buit from the title', primary_key = True)
    title = models.CharField('Title', max_length = 30)
    def __unicode__(self):
        return self.title

class Post(models.Model):
    slug = models.SlugField('Slug', primary_key = True)
    title = models.CharField('Title', max_length = 30)
    tags = models.ManyToManyField(Tag)
    date = models.DateTimeField('Date', auto_now = True)
    body = models.TextField('Body text')
    class Meta:
        ordering = ('-date', )

class Persona(models.Model):
    nombre = models.CharField(verbose_name = 'Nombre', max_length = 50)

class Empleado(Persona):
    sueldo = models.IntegerField()

class Jefe(Empleado):
    empleados = models.ManyToManyField(Empleado, related_name = 'jefes')