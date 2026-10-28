const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function loadService(rows, failTable) {
  const supabase = { from(table) {
    const filters = [];
    const conditions = [];
    const result = () => {
      if (table === failTable) return { data: null, error: new Error('Availability offline') };
      let data = rows[table] || [];
      for (const [key, value] of filters) data = data.filter(row => row[key] === value);
      data = data.filter(row => conditions.every(check => check(row)));
      return { data, error: null };
    };
    return {
      select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
      is(key, value) { filters.push([key, value]); return this; },
      in(key, values) { conditions.push(row => values.includes(row[key])); return this; },
      lt(key, value) { conditions.push(row => row[key] < value); return this; },
      gt(key, value) { conditions.push(row => row[key] > value); return this; },
      or(value) { const staff = value.split('staff_id.eq.')[1]; conditions.push(row => row.staff_id == null || row.staff_id === staff); return this; },
      async single() { const response = result(); return { ...response, data: response.data?.[0] }; },
      async maybeSingle() {
        const response = result();
        return response.data?.length > 1 ? { data: null, error: new Error('Multiple calendars') } : { ...response, data: response.data?.[0] };
      },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  } };
  supabase.rpc = async (name, args) => {
    assert.equal(name, 'booking_busy_intervals');
    if (failTable === 'bookings') return { data: null, error: new Error('Availability offline') };
    const start = new Date(args.p_date + 'T00:00:00+01:00').toISOString();
    const end = new Date(Date.parse(start) + 86400000).toISOString();
    const data = (rows.bookings || []).filter(row => row.business_id === args.p_business_id
      && ['requested', 'confirmed'].includes(row.status)
      && (!args.p_staff_id || !row.staff_id || row.staff_id === args.p_staff_id)
      && (!args.p_exclude_booking_id || row.id !== args.p_exclude_booking_id)
      && row.appointment_time < end && row.end_time > start)
      .map(({ appointment_time, end_time }) => ({ appointment_time, end_time }));
    return { data, error: null };
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/lib/bookings/booking-service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.includes('authenticated-fetch') ? {} : name.includes('supabase') ? { supabase } : require(name), module, module.exports);
  return module.exports.BookingService;
}

const rows = {
  service_offerings: [{ id: 'service', business_id: 'shop', is_active: true, duration_minutes: 60 }],
  provider_availability: [
    { business_id: 'shop', staff_id: null, day_of_week: 2, is_available: true, start_time: '09:00', end_time: '12:00' },
    { business_id: 'shop', staff_id: 'staff', day_of_week: 2, is_available: true, start_time: '14:00', end_time: '17:00' },
  ],
  availability_exceptions: [
    { business_id: 'shop', staff_id: 'staff', date: '2030-01-01', is_blackout: true },
  ],
  bookings: [],
};

test('default calendar ignores staff-specific hours and blackout dates', async () => {
  const service = loadService(rows);
  const slots = await service.getAvailableSlots('shop', 'service', '2030-01-01', null);
  assert.equal(slots.length, 5);
  assert.equal(slots[0].time, '2030-01-01T08:00:00.000Z');
  assert.deepEqual(await service.getAvailableSlots('shop', 'service', '2030-01-01', 'staff'), []);
});

test('availability lookup failure is surfaced rather than advertising open slots', async () => {
  await assert.rejects(loadService(rows, 'bookings').getAvailableSlots('shop', 'service', '2030-01-01', null), /Availability offline/);
});

test('business-wide bookings block named staff and distinct staff may work in parallel', async () => {
  const fixture = { ...rows, availability_exceptions: [], provider_availability: rows.provider_availability.map(row => ({ ...row, start_time:'09:00', end_time:'12:00' })), bookings: [
    { business_id:'shop', staff_id:null, status:'requested', appointment_time:'2030-01-01T08:00:00.000Z',end_time:'2030-01-01T09:00:00.000Z' },
    { business_id:'shop', staff_id:'other', status:'confirmed', appointment_time:'2030-01-01T09:00:00.000Z',end_time:'2030-01-01T10:00:00.000Z' },
    { business_id:'shop', staff_id:'staff', status:'cancelled', appointment_time:'2030-01-01T10:00:00.000Z',end_time:'2030-01-01T11:00:00.000Z' },
  ] };
  const service = loadService(fixture);
  const named = await service.getAvailableSlots('shop','service','2030-01-01','staff');
  assert.equal(named.find(s => s.time==='2030-01-01T08:00:00.000Z').available,false);
  assert.equal(named.find(s => s.time==='2030-01-01T09:00:00.000Z').available,true);
  const any = await service.getAvailableSlots('shop','service','2030-01-01',null);
  assert.equal(any.find(s => s.time==='2030-01-01T09:00:00.000Z').available,false);
  assert.equal(any.find(s => s.time==='2030-01-01T10:00:00.000Z').available,true);
});
