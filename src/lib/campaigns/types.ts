export interface CampaignEntry {
  rank: number;
  businessId: string;
  name: string;
  logoUrl: string | null;
  profilePath: string;
  completedSales: number;
}

export interface CampaignResponse {
  campaign: {
    id: string;
    slug: string;
    title: string;
    status: "upcoming" | "active" | "review" | "finalized";
    startsAt: string;
    endsAt: string;
    reviewEndsAt: string;
    timezone: string;
    prizePoolNaira: number;
    rulesVersion: string;
    integrityReviewRequired: boolean;
  };
  snapshot: {
    id: string;
    updatedAt: string;
    provisional: boolean;
    entries: CampaignEntry[];
    participantCount: number;
    prizeAllocations: { businessId: string; amountKobo: number }[];
  };
}

export interface CampaignParticipation {
  id: string;
  businessId: string;
  status: "pending" | "approved" | "rejected" | "suspended" | "disqualified";
  approvedAt: string | null;
  reason: string | null;
}

export interface CampaignMeResponse extends CampaignResponse {
  businesses: { id: string; name: string; logoUrl: string | null }[];
  ownEntries: CampaignEntry[];
  snapshotId: string;
  updatedAt: string;
}

export interface CampaignAdminResponse extends CampaignResponse {
  participants: (CampaignParticipation & {
    ownerId: string;
    name: string;
    createdAt: string;
  })[];
  sales: {
    transactionId: string;
    businessId: string;
    businessName: string;
    buyerId: string;
    sellerId: string;
    createdAt: string;
    completedAt: string | null;
    environment: "test" | "live";
    qualified: boolean;
    reason: string;
    manualHold: boolean;
    reviewRequired: boolean;
    suspicionSignals: string[];
    events: { event: string; observedAt: string }[];
  }[];
  audit: {
    id: string;
    actorId: string | null;
    action: string;
    reason: string;
    subjectId: string | null;
    createdAt: string;
  }[];
  canFinalize: boolean;
  prizeRecords: {
    id: string;
    businessId: string;
    kind: "verification" | "payment";
    status: string;
    amountKobo: number | null;
    reference: string | null;
    reason: string;
    actorId: string;
    createdAt: string;
  }[];
}
