/**
 * Reading and writing a workflow.
 *
 * THE MAPPERS LIST EVERY COLUMN BY HAND, which is this codebase's standing hazard rather than a
 * style choice: a column present in the database, in the type and in the select, but missing from
 * the mapper, reads as undefined for ever and nothing fails. diary_capacity sat in that state for
 * months. The check beside this file compares the two lists.
 */
import { supabase } from './supabase'
import type {
  Channel, DeadlineUnit, NodeKind, Workflow, WorkflowConnection, WorkflowNode, WorkflowPhase,
  VersionState,
} from './workflowBuilder.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON from PostgREST. */

const toPhase = (r: any): WorkflowPhase => ({
  id: r.id,
  ordinal: r.ordinal,
  name: r.name,
  subtitle: r.subtitle,
  fromDay: r.from_day,
  toDay: r.to_day,
})

const toNode = (r: any): WorkflowNode => ({
  id: r.id,
  phaseId: r.phase_id,
  key: r.key,
  kind: r.kind as NodeKind,
  label: r.label,
  description: r.description,
  day: r.day,
  deadlineDays: r.deadline_days,
  deadlineUnit: r.deadline_unit as DeadlineUnit | null,
  channel: r.channel as Channel | null,
  templateId: r.template_id,
  statutory: r.statutory,
  assignTo: r.assign_to,
  x: r.x,
  y: r.y,
  ordinal: r.ordinal,
})

const toConnection = (r: any): WorkflowConnection => ({
  id: r.id,
  fromNodeId: r.from_node_id,
  toNodeId: r.to_node_id,
  toWorkflowId: r.to_workflow_id,
  label: r.label,
})

export interface WorkflowSummary {
  id: string
  key: string
  name: string
  description: string | null
  versions: { id: string; version: number; state: VersionState }[]
}

/** Every workflow, for the list. Versions come with it so the list can say draft or active. */
export async function fetchWorkflows(): Promise<WorkflowSummary[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, key, name, description, workflow_versions(id, version, state)')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    versions: (r.workflow_versions ?? [])
      .map((v: any) => ({ id: v.id, version: v.version, state: v.state as VersionState }))
      .sort((a: any, b: any) => b.version - a.version),
  }))
}

/**
 * One workflow at one version.
 *
 * WHICH VERSION, IF NOBODY SAYS: the draft if there is one, otherwise the active one, otherwise
 * the newest. That order is the useful one — somebody opening the builder is going to edit, and
 * landing them on a frozen version so that their first keystroke is refused is a worse first
 * second than landing them on the draft they already have open.
 */
export async function fetchWorkflow(key: string, versionId?: string): Promise<Workflow | null> {
  const { data: wf, error } = await supabase
    .from('workflows')
    .select('id, key, name, description, teams(name), workflow_versions(id, version, state, published_at)')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!wf) return null

  const versions = ((wf as any).workflow_versions ?? []) as any[]
  const chosen = versionId
    ? versions.find((v) => v.id === versionId)
    : versions.find((v) => v.state === 'draft')
      ?? versions.find((v) => v.state === 'active')
      ?? [...versions].sort((a, b) => b.version - a.version)[0]
  if (!chosen) return null

  const [phases, nodes, connections] = await Promise.all([
    supabase.from('workflow_phases')
      .select('id, ordinal, name, subtitle, from_day, to_day')
      .eq('version_id', chosen.id).order('ordinal'),
    supabase.from('workflow_nodes')
      .select('id, phase_id, key, kind, label, description, day, deadline_days, deadline_unit, channel, template_id, statutory, assign_to, x, y, ordinal')
      .eq('version_id', chosen.id).order('day').order('ordinal'),
    supabase.from('workflow_connections')
      .select('id, from_node_id, to_node_id, to_workflow_id, label')
      .eq('version_id', chosen.id),
  ])
  for (const r of [phases, nodes, connections]) if (r.error) throw new Error(r.error.message)

  return {
    id: (wf as any).id,
    key: (wf as any).key,
    name: (wf as any).name,
    description: (wf as any).description,
    teamName: (wf as any).teams?.name ?? null,
    version: {
      id: chosen.id,
      version: chosen.version,
      state: chosen.state as VersionState,
      publishedAt: chosen.published_at ?? null,
    },
    phases: (phases.data ?? []).map(toPhase),
    nodes: (nodes.data ?? []).map(toNode),
    connections: (connections.data ?? []).map(toConnection),
  }
}

/**
 * Save one step.
 *
 * ONLY THE FIELDS THE FORM OWNS. Sending the whole row back would overwrite x and y with whatever
 * the form happened to be holding, and the position of a card on the canvas is not the step
 * editor's business — it belongs to the drag, which saves separately.
 */
export async function saveNode(node: WorkflowNode): Promise<void> {
  const { error } = await supabase
    .from('workflow_nodes')
    .update({
      label: node.label,
      description: node.description,
      day: node.day,
      deadline_days: node.deadlineDays,
      deadline_unit: node.deadlineUnit,
      kind: node.kind,
      channel: node.channel,
      template_id: node.templateId,
      statutory: node.statutory,
      assign_to: node.assignTo,
    })
    .eq('id', node.id)
  if (error) throw new Error(friendly(error.message))
}

/** Where a card sits. Saved on its own, because moving one changes nothing about what runs. */
export async function saveNodePosition(nodeId: string, x: number, y: number): Promise<void> {
  const { error } = await supabase.from('workflow_nodes').update({ x, y }).eq('id', nodeId)
  if (error) throw new Error(friendly(error.message))
}

/** Re-point what follows a step. Null unhooks it, which is how the last step in a line looks. */
export async function setNextNode(versionId: string, fromNodeId: string, toNodeId: string | null): Promise<void> {
  const del = await supabase.from('workflow_connections').delete().eq('from_node_id', fromNodeId)
  if (del.error) throw new Error(friendly(del.error.message))
  if (toNodeId === null) return
  const { error } = await supabase
    .from('workflow_connections')
    .insert({ version_id: versionId, from_node_id: fromNodeId, to_node_id: toNodeId })
  if (error) throw new Error(friendly(error.message))
}

export async function deleteNode(nodeId: string): Promise<void> {
  const { error } = await supabase.from('workflow_nodes').delete().eq('id', nodeId)
  if (error) throw new Error(friendly(error.message))
}

export interface NewNode {
  versionId: string
  phaseId: string | null
  kind: NodeKind
  label: string
  day: number
  ordinal: number
}

export async function addNode(input: NewNode): Promise<string> {
  /* A key a person can read, made unique by the clock rather than by a counter nobody maintains. */
  const key = `${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step'}-${Date.now().toString(36)}`
  const { data, error } = await supabase
    .from('workflow_nodes')
    .insert({
      version_id: input.versionId,
      phase_id: input.phaseId,
      key,
      kind: input.kind,
      label: input.label,
      day: input.day,
      ordinal: input.ordinal,
      /* A communication needs a channel to be valid, and email is the one that costs least to be
         wrong about — Annexure B item 1(a) is R25 against a registered post item. */
      channel: input.kind === 'communication' ? 'email' : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(friendly(error.message))
  return (data as any).id
}

/** "Click Edit: create a Draft version." The copy is done in the database, edges and all. */
export async function takeDraft(versionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('workflow_take_draft', { p_version: versionId })
  if (error) throw new Error(friendly(error.message))
  return data as string
}

export async function publish(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('workflow_publish', { p_version: versionId })
  if (error) throw new Error(friendly(error.message))
}

/**
 * The database's own words, where they are already the right ones.
 *
 * The frozen-version trigger raises a sentence written for a person to read, and passing it
 * through unchanged is better than a generic "could not save" — it says what to do next.
 */
function friendly(message: string): string {
  if (/published/i.test(message)) {
    return 'This version is published and cannot be changed. Take a draft of it first.'
  }
  if (/row-level security/i.test(message)) {
    return 'You do not have permission to change workflows.'
  }
  return message
}
