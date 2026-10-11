import { readQaEnv, createAdminClient, deterministicUuid, generatePassword, updateQaEnv, saveOutput, QA_PREFIX, QA_PROJECT_REF } from './qa-common.mjs';

const roles = [
  { key: 'buyer', label: 'Buyer', admin: false },
  { key: 'seller', label: 'Seller 950', admin: false },
  { key: 'organizer', label: 'Organizer Seller 1200', admin: false },
  { key: 'admin', label: 'Admin', admin: true },
  { key: 'non_admin', label: 'Non-admin', admin: false },
];

async function requireOk(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function findAuthUserByEmail(client, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`List auth users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error('Auth user lookup exceeded 20,000 users');
}

async function ensureUser(client, role, email, password, onAuthUser) {
  const existing = await findAuthUserByEmail(client, email);
  let user;
  if (existing) {
    if (existing.user_metadata?.qa_prefix !== QA_PREFIX || existing.user_metadata?.qa_role !== role.key) {
      throw new Error(`Refusing to modify existing non-QA auth user for ${role.key}`);
    }
    const { data, error } = await client.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...existing.user_metadata, qa_prefix: QA_PREFIX, qa_role: role.key, name: `${QA_PREFIX} ${role.label}` },
    });
    if (error) throw new Error(`Update ${role.key}: ${error.message}`);
    user = data.user;
  } else {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { qa_prefix: QA_PREFIX, qa_role: role.key, name: `${QA_PREFIX} ${role.label}` },
    });
    if (error) throw new Error(`Create ${role.key}: ${error.message}`);
    user = data.user;
  }

  await onAuthUser(user.id);
  await requireOk(await client.from('users').upsert({
    id: user.id,
    email,
    name: `${QA_PREFIX} ${role.label}`,
    legal_name: `${QA_PREFIX} ${role.label}`,
    username: `yrdly_qa_${role.key}`,
    profile_completed: true,
    onboarding_status: 'completed',
    tour_completed: true,
    is_admin: role.admin,
    role: role.admin ? 'admin' : 'user',
    updated_at: new Date().toISOString(),
  }), `Upsert ${role.key} profile`);
  return user.id;
}

async function upsert(client, table, row, label) {
  await requireOk(await client.from(table).upsert(row), label);
}

async function main() {
  const { env, projectRef } = await readQaEnv();
  const client = createAdminClient(env);
  const oldPasswords = Object.fromEntries(roles.map((r) => [`QA_${r.key.toUpperCase()}_PASSWORD`, env[`QA_${r.key.toUpperCase()}_PASSWORD`] || generatePassword()]));
  const emails = Object.fromEntries(roles.map((r) => [`QA_${r.key.toUpperCase()}_EMAIL`, env[`QA_${r.key.toUpperCase()}_EMAIL`] || `yrdly.qa.${r.key}@example.test`]));
  await updateQaEnv({ ...emails, ...oldPasswords });

  const output = {
    qaPrefix: QA_PREFIX,
    projectRef,
    seedState: 'initializing',
    createdAt: new Date().toISOString(),
    users: {},
    events: {
      paid: deterministicUuid('event:paid'),
      free: deterministicUuid('event:free'),
    },
    ticketTiers: {
      paidOneLeft: deterministicUuid('tier:paid-one-left'),
      free: deterministicUuid('tier:free'),
    },
    listings: {
      available: deterministicUuid('post:available-listing'),
      completedSale: deterministicUuid('post:completed-sale'),
    },
    transactions: {
      seller950Balance: deterministicUuid('tx:seller-950-balance'),
      completedSale: deterministicUuid('tx:completed-sale'),
    },
  };
  await saveOutput(output);

  for (const role of roles) {
    const emailKey = `QA_${role.key.toUpperCase()}_EMAIL`;
    await ensureUser(client, role, emails[emailKey], oldPasswords[`QA_${role.key.toUpperCase()}_PASSWORD`], async (id) => {
      output.users[role.key] = id;
      await saveOutput(output);
    });
    await saveOutput(output);
  }

  const now = Date.now();
  const eventBase = {
    description: `${QA_PREFIX} seeded event for staging QA. No real payment is involved.`,
    category: 'Community',
    location_address: `${QA_PREFIX} staging`,
    location_online: false,
    state: 'Lagos',
    timezone: 'Africa/Lagos',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    moderation_status: 'approved',
    published_at: new Date(now).toISOString(),
    start_time: new Date(now + 30 * 86400000).toISOString(),
    end_time: new Date(now + 31 * 86400000).toISOString(),
    organizer_id: output.users.organizer,
  };
  await upsert(client, 'events', { ...eventBase, id: output.events.paid, title: `${QA_PREFIX} Paid Event One Ticket Left` }, 'Upsert paid event');
  await upsert(client, 'events', { ...eventBase, id: output.events.free, title: `${QA_PREFIX} Free Event` }, 'Upsert free event');
  await upsert(client, 'ticket_tiers', {
    id: output.ticketTiers.paidOneLeft, event_id: output.events.paid,
    name: `${QA_PREFIX} Paid Tier`, description: `${QA_PREFIX} exactly one ticket remains`,
    price: 1500, capacity: 1, sold: 0, is_visible: true,
  }, 'Upsert paid ticket tier');
  await upsert(client, 'ticket_tiers', {
    id: output.ticketTiers.free, event_id: output.events.free,
    name: `${QA_PREFIX} Free Tier`, description: `${QA_PREFIX} free test tier`,
    price: 0, capacity: 30, sold: 0, is_visible: true,
  }, 'Upsert free ticket tier');

  const postBase = {
    user_id: output.users.organizer,
    author_name: `${QA_PREFIX} Organizer Seller 1200`,
    author_image: '', category: 'For Sale', sub_category: 'Other',
    text: `${QA_PREFIX} seeded marketplace listing. No payment provider was called.`,
    price: 2500, condition: 'New', image_urls: [], visibility: 'PUBLIC',
    moderation_status: 'approved', is_sold: false, liked_by: [], comment_count: 0,
    timestamp: new Date(now).toISOString(),
  };
  await upsert(client, 'posts', { ...postBase, id: output.listings.available, title: `${QA_PREFIX} Available Marketplace Listing` }, 'Upsert available listing');
  await upsert(client, 'posts', { ...postBase, id: output.listings.completedSale, title: `${QA_PREFIX} Completed Sale Listing`, transaction_id: null, sold_to_user_id: null, sold_at: null }, 'Upsert completed-sale listing');

  const commonTx = {
    status: 'completed', payment_method: 'card', payment_provider: 'qa_seed',
    delivery_details: { option: 'face_to_face' }, item_type: 'post',
    paid_at: new Date(now).toISOString(), completed_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  };
  await upsert(client, 'escrow_transactions', {
    ...commonTx, id: output.transactions.seller950Balance,
    buyer_id: output.users.buyer, seller_id: output.users.seller,
    item_id: deterministicUuid('fixture:seller-950-balance'),
    amount: 950, commission: 0, total_amount: 950, seller_amount: 950,
    metadata: { qa_prefix: QA_PREFIX, fixture: 'seller-balance-950' },
  }, 'Upsert seller balance fixture');
  await upsert(client, 'escrow_transactions', {
    ...commonTx, id: output.transactions.completedSale,
    buyer_id: output.users.buyer, seller_id: output.users.organizer,
    item_id: output.listings.completedSale,
    amount: 2500, commission: 75, total_amount: 2575, seller_amount: 2500,
    metadata: { qa_prefix: QA_PREFIX, fixture: 'completed-sale' },
  }, 'Upsert completed-sale transaction');

  const { error: linkError } = await client.from('posts').update({ transaction_id: output.transactions.completedSale, is_sold: true, sold_to_user_id: output.users.buyer, sold_at: new Date(now).toISOString() }).eq('id', output.listings.completedSale);
  if (linkError) throw new Error(`Link completed sale: ${linkError.message}`);

  output.completedAt = new Date().toISOString();
  output.seedState = 'complete';
  await saveOutput(output);
  console.log(`QA seed complete for project ${QA_PROJECT_REF}. IDs saved in qa-seed-output.json; account passwords are in .env.qa.`);
}

main().catch((error) => {
  console.error(`QA seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
