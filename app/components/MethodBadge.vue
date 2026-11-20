<script setup lang="ts">
defineProps<{ method: string }>()
</script>

<template>
  <span class="method-badge" :data-method="method">{{ method }}</span>
</template>
