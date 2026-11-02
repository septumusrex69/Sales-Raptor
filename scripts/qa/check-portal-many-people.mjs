#!/usr/bin/env node
/*
 * REQUEST #19 (Nicole, 30 Oct): "We should be able to allow multiple people from a specific client to have
 * access to their portal." The server always allowed it -- client_portal_users has no one-per-client rule,
 * only one-address-one-client -- but the card read as a slot for one person. This holds the two halves that
 * answer the request: the server keeps inserting a NEW login for a new address on the same client (rather
 * than, say, replacing the client's existing one), and the card says that more than one may be invited.
 */
import fs from 'node:fs'
const api = fs.readFileSync('api/_lib/portal.ts', 'utf8')
const card = fs.readFileSync('src/components/companies/PortalAccessCard.tsx', 'utf8')
const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
let pass = 0; const fails = []
const ok = (name, v) => { if (v) pass++; else fails.push(name) }

ok('a new address on the same client is a new login, inserted',
  /insert\(\{ company_id: co\.id, email, name, invited_by: staff\.id \}\)/.test(api))
ok('...looked up by the ADDRESS, not by the client (so a second person does not overwrite the first)',
  /from\('client_portal_users'\)\.select\('id, company_id'\)\.ilike\('email', email\)\.maybeSingle\(\)/.test(api))
ok('the table has no unique index on the client', !/unique index[^;]*client_portal_users \(company_id\)/i.test(schema))
ok('the card says as many as the client wants', /Invite as many as the client wants/.test(card))
ok('...and offers another person once there is one', /'Invite another person'/.test(card))

console.log(`check-portal-many-people: ${pass} passed, ${fails.length} failed`)
for (const f of fails) console.log(`  ✗ ${f}`)
process.exit(fails.length ? 1 : 0)
