<script setup lang="ts">
import type { LoggedRequest, StubMapping } from '#shared/types/wiremock'
import { compareRequest, comparisonPatch } from '#shared/utils/comparison'

const props = defineProps<{ mapping: StubMapping; request: LoggedRequest }>()
const mode = ref('split')
const changesOnly = ref(false)
const blocks = computed(() => compareRequest(props.mapping, props.request))
const visibleBlocks = computed(() =>
  changesOnly.value
    ? blocks.value.filter((block) => block.changed)
    : blocks.value
)
const totals = computed(() =>
  blocks.value.reduce(
    (sum, block) => ({
      additions: sum.additions + block.additions,
      removals: sum.removals + block.removals,
      changed: sum.changed + Number(block.changed)
    }),
    { additions: 0, removals: 0, changed: 0 }
  )
)
const expanded = reactive<Record<string, boolean>>({
  method: true,
  url: true,
  headers: true,
  query: true,
  path: true,
  body: true
})

function downloadPatch() {
  const blob = new Blob([comparisonPatch(blocks.value)], {
    type: 'text/x-diff'
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `wiretap-${props.mapping.id.slice(0, 8)}.patch`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="request-diff">
    <div class="diff-toolbar">
      <div class="diff-summary">
        <UIcon name="i-lucide-git-compare-arrows" /><span
          >{{ totals.changed }} changed
          {{ totals.changed === 1 ? 'block' : 'blocks' }}</span
        ><span class="added-text">+{{ totals.additions }}</span
        ><span class="removed-text">−{{ totals.removals }}</span>
      </div>
      <div class="diff-actions">
        <UCheckbox v-model="changesOnly" label="Changes only" size="sm" />
        <div class="segmented-control" aria-label="Diff layout">
          <button
            :class="{ active: mode === 'split' }"
            :aria-pressed="mode === 'split'"
            @click="mode = 'split'"
          >
            Split</button
          ><button
            :class="{ active: mode === 'unified' }"
            :aria-pressed="mode === 'unified'"
            @click="mode = 'unified'"
          >
            Unified
          </button>
        </div>
        <UButton
          icon="i-lucide-download"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Download full comparison patch"
          title="Download full patch"
          @click="downloadPatch"
        />
      </div>
    </div>
    <p class="diff-explanation">
      Text comparison of the mock’s rules and the received request. Regex,
      optional fields, and extra headers may differ on a matched request.
    </p>
    <div class="diff-legend">
      <span><span class="legend-line expected" />Mock · expected</span
      ><span><span class="legend-line received" />Request · received</span>
    </div>
    <div v-if="!visibleBlocks.length" class="small-empty">
      <UIcon name="i-lucide-check-check" />
      <p>No text differences in this pair.</p>
    </div>
    <section v-for="block in visibleBlocks" :key="block.id" class="diff-block">
      <button
        class="diff-block-heading"
        :aria-expanded="Boolean(expanded[block.id])"
        @click="expanded[block.id] = !expanded[block.id]"
      >
        <UIcon
          :name="
            expanded[block.id]
              ? 'i-lucide-chevron-down'
              : 'i-lucide-chevron-right'
          "
        />
        <span>{{ block.title }}</span>
        <span v-if="block.changed" class="block-counts"
          ><span class="added-text">+{{ block.additions }}</span
          ><span class="removed-text">−{{ block.removals }}</span></span
        >
        <span v-else class="block-unchanged">{{
          block.actual ? 'Identical' : 'Empty'
        }}</span>
      </button>
      <div v-if="expanded[block.id]" class="diff-block-content">
        <p v-if="block.hint" class="block-hint">{{ block.hint }}</p>
        <div v-if="!block.lines.length" class="empty-block">
          No constraint or received value
        </div>
        <div
          v-else-if="mode === 'split'"
          class="split-diff"
          role="table"
          :aria-label="`${block.title} comparison`"
        >
          <div
            v-for="(row, index) in block.split.slice(0, 2000)"
            :key="index"
            class="split-row"
            role="row"
          >
            <div
              class="diff-cell"
              :class="row.left?.kind || 'blank'"
              role="cell"
            >
              <span class="line-number">{{ row.left?.oldLine }}</span><span
                class="line-sign"
                >{{ row.left?.kind === 'removed' ? '−' : ' ' }}</span
              ><code>{{ row.left?.text ?? ' ' }}</code>
            </div>
            <div
              class="diff-cell"
              :class="row.right?.kind || 'blank'"
              role="cell"
            >
              <span class="line-number">{{ row.right?.newLine }}</span><span
                class="line-sign"
                >{{ row.right?.kind === 'added' ? '+' : ' ' }}</span
              ><code>{{ row.right?.text ?? ' ' }}</code>
            </div>
          </div>
        </div>
        <div
          v-else
          class="unified-diff"
          role="table"
          :aria-label="`${block.title} unified comparison`"
        >
          <div
            v-for="(line, index) in block.lines.slice(0, 2000)"
            :key="index"
            class="diff-cell"
            :class="line.kind"
            role="row"
          >
            <span class="line-number">{{ line.oldLine }}</span><span
              class="line-number"
              >{{ line.newLine }}</span
            ><span class="line-sign">{{
              line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '
            }}</span
            ><code>{{ line.text }}</code>
          </div>
        </div>
        <p
          v-if="
            (mode === 'split' ? block.split.length : block.lines.length) > 2000
          "
          class="block-hint"
        >
          Preview limited to 2,000 lines. Download the patch for the full
          comparison.
        </p>
      </div>
    </section>
  </div>
</template>
