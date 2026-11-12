// scripts/paypal-smoke.ts — REAL Sandbox requests from your machine.
//   npx tsx scripts/paypal-smoke.ts
// Reads .env.local. Does OAuth + creates one Sandbox order and prints the approval URL.
// It never captures: a human must approve in PayPal first.
import { readFileSync } from 'fs'
import { PayPalSandboxClient, readCredentials } from '../src/payments/paypal/client'

try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local; rely on real env */ }

async function main() {
  const creds = readCredentials()
  if (!creds) { console.error('FAIL: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing, or PAYPAL_MODE is not "sandbox"'); process.exit(1) }
  const client = new PayPalSandboxClient(creds)
  await client.probe()
  console.log('OK  OAuth against api-m.sandbox.paypal.com succeeded')
  const order = await client.createOrder({
    amountMinor: 599, currency: 'USD', description: '[SANDBOX] smoke test', referenceId: 'smoke_1', customId: 'smoke',
    requestId: `smoke-${Date.now()}`, returnUrl: 'http://localhost:3000/paypal/return', cancelUrl: 'http://localhost:3000/paypal/return?cancelled=1',
  })
  console.log(`OK  Created order ${order.id} (status ${order.status})`)
  console.log(`    Approve as your SANDBOX BUYER: ${order.approveUrl}`)
  const again = await client.getOrder(order.id)
  console.log(`OK  Re-read order from PayPal: ${again.status}`)
}
main().catch(e => { console.error('FAIL:', e instanceof Error ? e.message : e); process.exit(1) })
