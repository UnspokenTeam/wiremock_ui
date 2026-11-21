<script setup lang="ts">
import { pretty } from '#shared/utils/comparison'

const props = defineProps<{ value: unknown, label?: string }>()
const toast = useToast()
async function copy() {
  try {
    await navigator.clipboard.writeText(pretty(props.value))
    toast.add({ title: 'Copied to clipboard', color: 'success' })
  } catch {
    toast.add({
      title: 'Clipboard unavailable',
      description: 'Select and copy the text directly.',
      color: 'warning'
    })
  }
}
</script>

<template>
  <div class="json-view">
    <div class="json-heading">
      <span>{{ label || 'JSON' }}</span><UButton
        icon="i-lucide-copy"
        aria-label="Copy JSON"
        variant="ghost"
        color="neutral"
        size="xs"
        @click="copy"
      />
    </div>
    <pre>{{ pretty(value) || '(empty)' }}</pre>
  </div>
</template>
