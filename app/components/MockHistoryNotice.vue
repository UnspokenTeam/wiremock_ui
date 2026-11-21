<script setup lang="ts">
import type { MappingHistory } from '#shared/types/wiremock'

const { history } = defineProps<{ history?: MappingHistory }>()
const description = computed(() =>
  history?.deletedAt
    ? `Deletion detected on ${new Date(history.deletedAt).toLocaleString()}. This saved mock remains available for comparison and duplication.`
    : ''
)
</script>

<template>
  <UAlert
    v-if="history?.deletedAt"
    color="neutral"
    variant="subtle"
    icon="i-lucide-archive"
    title="Deleted mock · saved in history"
    :description="description"
  />
</template>
