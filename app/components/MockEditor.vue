<script setup lang="ts">
import type { MockDraft } from '#shared/utils/mocks'
import type { FormError, FormErrorEvent } from '@nuxt/ui'
import { isRecord, validateMock } from '#shared/utils/mocks'

const props = defineProps<{
  draft?: MockDraft
  editId?: string
  instanceName: string
  demo: boolean
  onSave: (value: MockDraft) => Promise<void>
}>()
const open = defineModel<boolean>('open')
const mode = shallowRef('form')
const name = shallowRef('')
const method = shallowRef('GET')
const urlType = shallowRef('urlPath')
const url = shallowRef('/api/example')
const priority = shallowRef('')
const persistent = shallowRef(false)
const matchers = shallowRef('{}')
const response = shallowRef('{}')
const raw = shallowRef('')
const error = shallowRef('')
const saving = shallowRef(false)
const state = reactive({
  name,
  method,
  urlType,
  url,
  priority,
  persistent,
  matchers,
  response,
  raw
})
let extraFields: Record<string, unknown> = {}
const urlKeys = [
  'url',
  'urlPath',
  'urlPathTemplate',
  'urlPattern',
  'urlPathPattern'
]
const urlTypes = [
  { label: 'Exact path', value: 'urlPath' },
  { label: 'Path template', value: 'urlPathTemplate' },
  { label: 'Exact path & query', value: 'url' },
  { label: 'Path regular expression', value: 'urlPathPattern' },
  { label: 'Path & query regular expression', value: 'urlPattern' },
  { label: 'Any URL', value: 'none' }
]

function populate(value: MockDraft) {
  const copy = JSON.parse(JSON.stringify(value)) as MockDraft
  name.value = copy.name ?? ''
  method.value = copy.request.method ?? 'ANY'
  urlType.value
    = urlKeys.find(key => copy.request[key] !== undefined) ?? 'none'
  url.value
    = urlType.value === 'none' ? '' : String(copy.request[urlType.value])
  priority.value = copy.priority === undefined ? '' : String(copy.priority)
  persistent.value = Boolean(copy.persistent)
  matchers.value = JSON.stringify(
    Object.fromEntries(
      Object.entries(copy.request).filter(
        ([key]) => key !== 'method' && !urlKeys.includes(key)
      )
    ),
    null,
    2
  )
  response.value = JSON.stringify(copy.response, null, 2)
  extraFields = Object.fromEntries(
    Object.entries(copy).filter(
      ([key]) =>
        ![
          'id',
          'uuid',
          'name',
          'request',
          'response',
          'priority',
          'persistent'
        ].includes(key)
    )
  )
}

function build(): MockDraft {
  const additional = JSON.parse(matchers.value)
  if (!isRecord(additional))
    throw new Error('Additional request matchers must be a JSON object.')
  if (
    Object.keys(additional).some(
      key => key === 'method' || urlKeys.includes(key)
    )
  )
    throw new Error(
      'Use the method and URL fields above instead of adding them to additional matchers.'
    )
  const value: MockDraft = {
    ...extraFields,
    ...(props.editId ? { id: props.editId } : {}),
    ...(name.value.trim() ? { name: name.value.trim() } : {}),
    ...(priority.value !== '' ? { priority: Number(priority.value) } : {}),
    persistent: persistent.value,
    request: {
      ...additional,
      method: method.value,
      ...(urlType.value !== 'none' ? { [urlType.value]: url.value } : {})
    },
    response: JSON.parse(response.value)
  }
  return validateMock(value)
}

function setMode(next: string) {
  if (next === mode.value) return
  error.value = ''
  try {
    if (next === 'json') raw.value = JSON.stringify(build(), null, 2)
    else populate(validateMock(JSON.parse(raw.value)))
    mode.value = next
  } catch (cause) {
    error.value = (cause as Error).message
  }
}

function validateFields(): FormError[] {
  const errors: FormError[] = []
  if (mode.value === 'json') {
    try {
      validateMock(JSON.parse(raw.value))
    } catch (cause) {
      errors.push({ name: 'raw', message: (cause as Error).message })
    }
    return errors
  }
  if (urlType.value !== 'none' && !url.value.trim())
    errors.push({ name: 'url', message: 'Enter a URL or path matching rule.' })
  if (
    priority.value !== ''
    && (!Number.isInteger(Number(priority.value)) || Number(priority.value) < 1)
  )
    errors.push({
      name: 'priority',
      message: 'Priority must be a positive integer.'
    })
  try {
    const extra = JSON.parse(matchers.value)
    if (!isRecord(extra))
      throw new Error('Additional matchers must be a JSON object.')
    if (
      Object.keys(extra).some(
        key => key === 'method' || urlKeys.includes(key)
      )
    )
      throw new Error('Set the method and URL in the fields above.')
  } catch (cause) {
    errors.push({ name: 'matchers', message: (cause as Error).message })
  }
  try {
    validateMock({ request: {}, response: JSON.parse(response.value) })
  } catch (cause) {
    errors.push({ name: 'response', message: (cause as Error).message })
  }
  return errors
}

function focusError(event: FormErrorEvent) {
  const id = event.errors[0]?.id
  if (id) document.getElementById(id)?.focus()
}

watch(open, (visible) => {
  if (!visible) return
  mode.value = 'form'
  error.value = ''
  populate(
    props.draft ?? {
      name: 'New mock',
      request: { method: 'GET', urlPath: '/api/example' },
      response: { status: 200, jsonBody: { message: 'Hello from WireMock' } }
    }
  )
})

async function save() {
  error.value = ''
  try {
    const value
      = mode.value === 'json' ? validateMock(JSON.parse(raw.value)) : build()
    if (props.editId && value.id && value.id !== props.editId)
      throw new Error('The mock ID cannot be changed when editing.')
    saving.value = true
    await props.onSave(value)
    open.value = false
  } catch (cause) {
    const detail = cause as {
      message?: string
      data?: { statusMessage?: string, data?: { details?: string } }
    }
    error.value = [
      detail.data?.statusMessage
      ?? detail.message
      ?? 'Could not save this mock.',
      detail.data?.data?.details
    ]
      .filter(Boolean)
      .join('\n')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editId ? 'Edit mock' : 'Create mock'"
    :description="`${demo ? 'Sample workspace' : instanceName} · ${demo ? 'Changes affect sample data only' : 'Changes apply to this WireMock instance'}`"
    :dismissible="!saving"
    :close="!saving"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #body>
      <UForm
        id="mock-editor-form"
        :state="state"
        :validate="validateFields"
        @submit="save"
        @error="focusError"
      >
        <div class="editor-toolbar">
          <div
            class="segmented-control"
            aria-label="Mock editor mode"
          >
            <button
              type="button"
              :class="{ active: mode === 'form' }"
              :aria-pressed="mode === 'form'"
              @click="setMode('form')"
            >
              Form
            </button><button
              type="button"
              :class="{ active: mode === 'json' }"
              :aria-pressed="mode === 'json'"
              @click="setMode('json')"
            >
              Full JSON
            </button>
          </div>
          <code
            v-if="editId"
            class="editor-id"
          >{{ editId }}</code>
        </div>
        <UAlert
          v-if="error"
          title="Mock was not saved"
          :description="error"
          color="error"
          variant="subtle"
          class="editor-error"
        />
        <div
          v-if="mode === 'form'"
          class="editor-fields"
        >
          <UFormField
            label="Mock name"
            name="name"
          >
            <UInput
              v-model="name"
              placeholder="Get order details"
              :disabled="saving"
            />
          </UFormField>
          <div class="editor-url-fields">
            <UFormField
              label="HTTP method"
              name="method"
            >
              <USelect
                v-model="method"
                :items="[
                  'GET',
                  'POST',
                  'PUT',
                  'PATCH',
                  'DELETE',
                  'HEAD',
                  'OPTIONS',
                  'ANY',
                  'TRACE',
                  'CONNECT'
                ]"
                :disabled="saving"
              />
            </UFormField><UFormField
              label="URL matching"
              name="urlType"
            >
              <USelect
                v-model="urlType"
                :items="urlTypes"
                :disabled="saving"
              />
            </UFormField>
          </div>
          <UFormField
            v-if="urlType !== 'none'"
            label="Request URL or path"
            name="url"
            required
          >
            <UInput
              v-model="url"
              placeholder="/api/orders/{orderId}"
              :disabled="saving"
              required
            />
          </UFormField>
          <div class="editor-url-fields">
            <UFormField
              label="Priority"
              name="priority"
              hint="Optional"
            >
              <UInput
                v-model="priority"
                type="number"
                :min="1"
                placeholder="5"
                :disabled="saving"
              />
            </UFormField><UFormField
              label="Persistence"
              name="persistent"
            >
              <UCheckbox
                v-model="persistent"
                label="Keep on WireMock disk"
                :disabled="saving"
              />
            </UFormField>
          </div>
          <div class="editor-json-fields">
            <UFormField
              label="Additional request matchers (JSON)"
              name="matchers"
              description="Headers, query/path parameters, bodyPatterns, cookies, or other rules."
            >
              <UTextarea
                v-model="matchers"
                :rows="13"
                :spellcheck="false"
                class="code-input"
                :disabled="saving"
              />
            </UFormField><UFormField
              label="Response definition (JSON)"
              name="response"
              description="Set status, headers, jsonBody/body, delays, faults, or transformers."
            >
              <UTextarea
                v-model="response"
                :rows="13"
                :spellcheck="false"
                class="code-input"
                :disabled="saving"
              />
            </UFormField>
          </div>
        </div>
        <UFormField
          v-else
          label="Complete WireMock mapping (JSON)"
          name="raw"
          description="All WireMock fields are preserved. An existing mock’s ID stays the same."
        >
          <UTextarea
            v-model="raw"
            :rows="24"
            :spellcheck="false"
            class="code-input"
            :disabled="saving"
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <UButton
        type="submit"
        form="mock-editor-form"
        :label="editId ? 'Save changes' : 'Create mock'"
        :loading="saving"
      /><UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        :disabled="saving"
        @click="open = false"
      />
    </template>
  </UModal>
</template>
