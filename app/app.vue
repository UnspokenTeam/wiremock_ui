<script setup lang="ts">
useHead({
  title: 'Wiretap · WireMock workspace',
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  htmlAttrs: { lang: 'en' }
})
useSeoMeta({
  description:
    'Inspect WireMock traffic, find mock routes, and compare every part of a request.'
})
</script>

<template>
  <UApp><NuxtPage /></UApp>
</template>
