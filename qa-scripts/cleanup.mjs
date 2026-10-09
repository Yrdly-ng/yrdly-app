import { readQaEnv, createAdminClient, readOutput, QA_PREFIX } from './qa-common.mjs';

async function removeByIds(client, table, ids) {
  const values = (ids || []).filter(Boolean);
  if (!values.length) return;
  const { error } = await client.from(table).delete().in('id', values);
  if (error) throw new Error(`Delete ${table}: ${error.message}`);
}

async function main() {
  const output = await readOutput();
  const { env, projectRef } = await readQaEnv();
  if (output.projectRef !== projectRef || output.qaPrefix !== QA_PREFIX) throw new Error('Refusing cleanup: target validation failed');
  const client = createAdminClient(env);

  const listingIds = Object.values(output.listings || {}).filter(Boolean);
  if (listingIds.length) {
    const { error } = await client.from('posts').update({ transaction_id: null, is_sold: false, sold_to_user_id: null, sold_at: null }).in('id', listingIds);
    if (error) throw new Error(`Detach QA listings: ${error.message}`);
  }
  await removeByIds(client, 'escrow_transactions', Object.values(output.transactions || {}));
  await removeByIds(client, 'posts', Object.values(output.listings || {}));
  await removeByIds(client, 'tickets', Object.values(output.tickets || {}));
  await removeByIds(client, 'ticket_tiers', Object.values(output.ticketTiers || {}));
  await removeByIds(client, 'events', Object.values(output.events || {}));

  for (const userId of Object.values(output.users || {})) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error && !/user not found/i.test(error.message)) throw new Error(`Delete QA auth user: ${error.message}`);
  }
  console.log(`QA seed cleanup complete for project ${projectRef}.`);
}

main().catch((error) => {
  console.error(`QA cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
