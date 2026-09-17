import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface Category {
  id: string;
  name: string;
  type: string;
  icon?: string;
  is_active: boolean;
}

const FALLBACK_CATEGORIES: Record<string, Category[]> = {
  marketplace: [
    { id: "1", name: "Electronics", type: "marketplace", is_active: true },
    { id: "2", name: "Fashion", type: "marketplace", is_active: true },
    { id: "3", name: "Home & Garden", type: "marketplace", is_active: true },
    { id: "4", name: "Vehicles", type: "marketplace", is_active: true },
    { id: "5", name: "Services", type: "marketplace", is_active: true },
    { id: "6", name: "Books & Media", type: "marketplace", is_active: true },
    { id: "7", name: "Free / Giveaway", type: "marketplace", is_active: true },
    { id: "8", name: "Other", type: "marketplace", is_active: true },
  ],
  event: [
    { id: "e1", name: "Social", type: "event", is_active: true },
    { id: "e2", name: "Workshop", type: "event", is_active: true },
    { id: "e3", name: "Party", type: "event", is_active: true },
    { id: "e4", name: "Sports", type: "event", is_active: true },
    { id: "e5", name: "Community", type: "event", is_active: true },
  ],
  report: [
    { id: "r1", name: "Noise & Disturbance", type: "report", is_active: true },
    { id: "r2", name: "Suspicious Activity", type: "report", is_active: true },
    { id: "r3", name: "Traffic & Parking", type: "report", is_active: true },
    { id: "r4", name: "General Safety", type: "report", is_active: true },
  ],
};

export function useCategories(type: "marketplace" | "event" | "report" = "marketplace") {
  const [categories, setCategories] = useState<Category[]>(FALLBACK_CATEGORIES[type] || []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("*")
          .eq("type", type)
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (error || !data || data.length === 0) {
          setCategories(FALLBACK_CATEGORIES[type] || []);
        } else {
          setCategories(data);
        }
      } catch (err) {
        console.error("useCategories error:", err);
        setCategories(FALLBACK_CATEGORIES[type] || []);
      } finally {
        setLoading(false);
      }
    }

    fetchCategories();
  }, [type]);

  return { categories, loading };
}
