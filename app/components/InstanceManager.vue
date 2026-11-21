<script setup lang="ts">
import type { WireMockInstance } from '#shared/utils/instances'
import type { FormError } from '@nuxt/ui'
import {
  defaultInstanceId,
  normalizeInstanceUrl,
  pollingIntervals
} from '#shared/utils/instances'

const props = defineProps<{
  instances: WireMockInstance[]
  defaultUrl: string
  loading: boolean
  busy: boolean
  demo: boolean
  onSave: (instance: { id?: string, name: string, url: string }) => void
  onRemove: (id: string) => void
  onRetry: () => Promise<void>
}>()
const emit = defineEmits<{ setDemo: [value: boolean] }>()
const open = defineModel<boolean>('open')
const activeId = defineModel<string>('activeId', { required: true })
const pollMs = defineModel<number>('pollMs', { required: true })
const live = defineModel<boolean>('live', { required: true })
const editing = shallowRef(false)
const editId = shallowRef<string>()
const state = reactive({ name: '', url: '' })
const { name, url } = toRefs(state)
const error = shallowRef('')
const rates = pollingIntervals.map(value => ({
  label: `Every ${value / 1000} second${value === 1000 ? '' : 's'}`,
  value: Number(value)
}))

function edit(instance?: WireMockInstance) {
  editId.value = instance?.id
  name.value = instance?.name ?? ''
  url.value = instance?.url ?? ''
  error.value = ''
  editing.value = true
}
function save() {
  try {
    props.onSave({ id: editId.value, name: name.value, url: url.value })
    editing.value = false
    error.value = ''
  } catch (cause) {
    error.value = (cause as Error).message
  }
}

function validate(): FormError[] {
  const errors: FormError[] = []
  if (!name.value.trim() || name.value.trim().length > 80)
    errors.push({
      name: 'name',
      message: 'Enter a name of up to 80 characters.'
    })
  try {
    normalizeInstanceUrl(url.value)
  } catch (cause) {
    errors.push({ name: 'url', message: (cause as Error).message })
  }
  return errors
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Instances & refresh"
    description="Switch WireMock instances instantly. Your choices are saved in this browser."
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <div class="instance-manager">
        <div class="settings-section-heading">
          <h3>WireMock instances</h3>
          <UButton
            icon="i-lucide-plus"
            label="Add instance"
            size="sm"
            variant="soft"
            :disabled="busy"
            @click="edit()"
          />
        </div>
        <div class="instance-list">
          <div
            v-for="instance in instances"
            :key="instance.id"
            class="instance-row"
            :class="{ selected: activeId === instance.id }"
          >
            <button
              class="instance-target"
              :disabled="busy"
              :aria-label="`Use ${instance.name}`"
              :aria-pressed="activeId === instance.id"
              @click="activeId = instance.id"
            >
              <span class="instance-avatar"><UIcon
                :name="
                  activeId === instance.id
                    ? 'i-lucide-circle-check'
                    : 'i-lucide-server'
                "
              /></span>
              <span><strong>{{ instance.name }}</strong><code>{{ instance.url || defaultUrl }}</code><small v-if="instance.id === defaultInstanceId">Configured on the app server</small></span>
            </button>
            <div
              v-if="instance.id !== defaultInstanceId"
              class="instance-row-actions"
            >
              <UButton
                icon="i-lucide-pencil"
                :aria-label="`Edit ${instance.name}`"
                variant="ghost"
                color="neutral"
                size="sm"
                :disabled="busy"
                @click="edit(instance)"
              /><UButton
                icon="i-lucide-x"
                :aria-label="`Forget ${instance.name}`"
                title="Forget this address; mocks stay in WireMock"
                variant="ghost"
                color="neutral"
                size="sm"
                :disabled="busy"
                @click="onRemove(instance.id)"
              />
            </div>
          </div>
        </div>
        <UForm
          v-if="editing"
          :state="state"
          :validate="validate"
          class="instance-form"
          @submit="save"
        >
          <h4>{{ editId ? 'Edit instance' : 'Add an instance' }}</h4>
          <UFormField
            label="Instance name"
            name="name"
            required
          >
            <UInput
              v-model="name"
              placeholder="Local development"
              :maxlength="80"
              required
            />
          </UFormField>
          <UFormField
            label="WireMock URL"
            name="url"
            required
          >
            <UInput
              v-model="url"
              placeholder="http://wiremock:8080"
              required
            />
          </UFormField>
          <p class="settings-hint">
            Use an address reachable from the app server. In Docker, this is
            usually a service name such as <code>http://wiremock:8080</code>.
          </p>
          <UAlert
            v-if="error"
            :title="error"
            color="error"
            variant="subtle"
          />
          <div class="form-actions">
            <UButton
              type="submit"
              :label="editId ? 'Save & connect' : 'Add & connect'"
              :disabled="busy"
            /><UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="editing = false"
            />
          </div>
        </UForm>
        <div class="connection-options">
          <span><strong>Polling interval</strong><small>Time between completed refreshes</small></span><USelect
            v-model="pollMs"
            :items="rates"
            aria-label="Polling interval"
            class="polling-select"
          />
        </div>
        <div class="connection-options">
          <span><strong>Live refresh</strong><small>Pause without changing your selected interval</small></span><USwitch
            v-model="live"
            aria-label="Live refresh"
          />
        </div>
        <div class="connection-options">
          <span><strong>Demo workspace</strong><small>Try changes on separate sample data</small></span><USwitch
            :model-value="demo"
            aria-label="Demo workspace"
            :disabled="busy"
            @update:model-value="emit('setDemo', $event)"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <UButton
        label="Done"
        @click="open = false"
      /><UButton
        v-if="!demo"
        icon="i-lucide-refresh-cw"
        label="Retry connection"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="onRetry"
      />
    </template>
  </UModal>
</template>
