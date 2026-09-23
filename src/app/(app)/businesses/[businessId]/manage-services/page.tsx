'use me';
'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useServiceOfferings } from '@/hooks/use-bookings';
import { BookingService } from '@/lib/booking-service';

export default function ManageServicesWebPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;

  const { offerings, loading, refresh } = useServiceOfferings(businessId);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [price, setPrice] = useState('');
  const [priceIsFrom, setPriceIsFrom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const openAddModal = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setDurationMinutes('60');
    setPrice('');
    setPriceIsFrom(false);
    setErrorMsg('');
    setModalVisible(true);
  };

  const openEditModal = (offering: any) => {
    setEditingId(offering.id);
    setName(offering.name);
    setDescription(offering.description || '');
    setDurationMinutes(String(offering.duration_minutes));
    setPrice(offering.price ? String(offering.price) : '');
    setPriceIsFrom(offering.price_is_from || false);
    setErrorMsg('');
    setModalVisible(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrorMsg('Service name is required');
    const duration = parseInt(durationMinutes, 10);
    if (isNaN(duration) || duration <= 0) return setErrorMsg('Valid duration in minutes is required');

    setSaving(true);
    setErrorMsg('');
    try {
      const parsedPrice = price.trim() ? parseFloat(price) : undefined;
      if (editingId) {
        await BookingService.updateServiceOffering(editingId, {
          name: name.trim(),
          description: description.trim() || undefined,
          duration_minutes: duration,
          price: parsedPrice,
          price_is_from: priceIsFrom,
        });
      } else {
        await BookingService.createServiceOffering({
          business_id: businessId,
          name: name.trim(),
          description: description.trim() || undefined,
          duration_minutes: duration,
          price: parsedPrice,
          price_is_from: priceIsFrom,
          is_active: true,
        });
      }
      setModalVisible(false);
      refresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save service offering');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (offeringId: string) => {
    if (!confirm('Are you sure you want to remove this service?')) return;
    try {
      await BookingService.deleteServiceOffering(offeringId);
      refresh();
    } catch (err: any) {
      alert(err.message || 'Failed to delete service');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-100 transition"
            >
              ← Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-neutral-100">Manage Services</h1>
              <p className="text-sm text-neutral-400">Add, edit, or configure service offerings for your business</p>
            </div>
          </div>
          <button
            onClick={openAddModal}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold rounded-xl text-sm transition shadow-lg shadow-emerald-500/10"
          >
            + Add New Service
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-20 text-center text-neutral-400">Loading service offerings...</div>
        ) : offerings.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-neutral-800 rounded-2xl my-8 bg-neutral-900/40">
            <p className="text-neutral-400 text-lg mb-4">No service offerings added yet</p>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold rounded-xl text-sm transition"
            >
              + Create Your First Service
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {offerings.map((item) => (
              <div
                key={item.id}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 hover:border-neutral-700 transition"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-bold text-neutral-100">{item.name}</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(item)}
                      className="px-2.5 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="px-2.5 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {item.description && (
                  <p className="text-sm text-neutral-400 mt-2 line-clamp-2">{item.description}</p>
                )}

                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-neutral-800/60 text-xs text-neutral-400">
                  <span className="bg-neutral-950 px-2.5 py-1 rounded-md border border-neutral-800">
                    ⏱ {item.duration_minutes} mins
                  </span>
                  {item.price !== undefined && item.price !== null && (
                    <span className="bg-neutral-950 px-2.5 py-1 rounded-md border border-neutral-800 text-emerald-400 font-semibold">
                      {item.price_is_from ? 'From ' : ''}₦{item.price.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {modalVisible && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form
              onSubmit={handleSave}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              <h2 className="text-xl font-bold text-neutral-100 mb-4">
                {editingId ? 'Edit Service Offering' : 'Add Service Offering'}
              </h2>

              {errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl mb-4">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-4 text-sm">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Service Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Haircut & Beard Trim"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Details about what's included..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-neutral-300 font-medium mb-1">Duration (mins) *</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-neutral-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-neutral-300 font-medium mb-1">Price (₦)</label>
                    <input
                      type="number"
                      min={0}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="e.g. 5000"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={priceIsFrom}
                    onChange={(e) => setPriceIsFrom(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-500 bg-neutral-950 border-neutral-800"
                  />
                  <span className="text-neutral-300 text-xs">Price is a "Starting from" estimate</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setModalVisible(false)}
                  disabled={saving}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-semibold rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold rounded-xl transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
