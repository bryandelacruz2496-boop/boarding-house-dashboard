// Shared payment/collection calculations.
// Payments are tracked per-tenant in `tenant_payments`. The room-level
// `billing.payment_status === 'SETTLED'` is honored as a manual override so
// historical/manually-settled rooms still count fully.

const WIFI_PER_PERSON = 200;

/**
 * Compute how much of a room's billing has actually been collected,
 * based on per-tenant payments (with room-level SETTLED as an override).
 *
 * @returns {Promise<{total:number, collected:number, outstanding:number,
 *   tenantCount:number, paidCount:number, status:string}>}
 */
async function computeRoomCollection(db, billing, month, year) {
  if (!billing) {
    return { total: 0, collected: 0, outstanding: 0, tenantCount: 0, paidCount: 0, status: 'NO BILLING' };
  }

  const total = billing.total || 0;

  // Manual override: whole room marked settled.
  if (billing.payment_status === 'SETTLED') {
    return { total, collected: total, outstanding: 0, tenantCount: 0, paidCount: 0, status: 'SETTLED' };
  }

  const tenants = await db.collection('tenants')
    .find({ room_id: billing.room_id, is_active: 1 }).toArray();
  const tenantCount = tenants.length;

  if (tenantCount === 0) {
    return { total, collected: 0, outstanding: total, tenantCount: 0, paidCount: 0, status: total > 0 ? 'UNSETTLED' : 'NO BILLING' };
  }

  // Per-tenant shares derived from stored billing components so the sum of
  // all tenant totals reconciles to billing.total.
  const rentShare = (billing.rent || 0) / tenantCount;
  const electricShare = (billing.electric_bill || 0) / tenantCount;
  const waterShare = (billing.water_bill || 0) / tenantCount;
  const garbageShare = (billing.garbage_fee || 0) / tenantCount;
  const penaltyShare = (billing.penalty || 0) / tenantCount;

  let collected = 0;
  let paidCount = 0;

  for (const t of tenants) {
    const wifiRecord = await db.collection('tenant_wifi_monthly')
      .findOne({ tenant_id: t._id.toString(), month, year });
    const hasWifi = wifiRecord ? wifiRecord.has_wifi : t.has_wifi;
    const wifiCost = hasWifi ? WIFI_PER_PERSON : 0;
    const tenantTotal = rentShare + wifiCost + electricShare + waterShare + garbageShare + penaltyShare;

    const payment = await db.collection('tenant_payments')
      .findOne({ tenant_id: t._id.toString(), billing_id: billing._id.toString() });
    if (payment && payment.paid) {
      collected += tenantTotal;
      paidCount++;
    }
  }

  const outstanding = Math.max(total - collected, 0);
  let status;
  if (paidCount === 0) status = 'UNSETTLED';
  else if (paidCount >= tenantCount) status = 'SETTLED';
  else status = 'PARTIAL';

  return { total, collected, outstanding, tenantCount, paidCount, status };
}

module.exports = { computeRoomCollection, WIFI_PER_PERSON };
