"use client";

import React from 'react';
import { EscrowStatus } from '@/types/escrow';
import { Badge } from '@/components/ui/badge';
import { 
  Clock, 
  CreditCard, 
  Truck, 
  Package, 
  CheckCircle, 
  AlertTriangle, 
  XCircle 
} from 'lucide-react';

interface EscrowStatusDisplayProps {
  status: EscrowStatus;
  showIcon?: boolean;
  className?: string;
}

export function EscrowStatusDisplay({ 
  status, 
  showIcon = true, 
  className = '' 
}: EscrowStatusDisplayProps) {
  const getStatusConfig = (status: EscrowStatus) => {
    switch (status) {
      case EscrowStatus.PENDING:
        return {
          label: 'Pending Payment',
          color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
          icon: Clock,
          iconColor: 'text-yellow-600'
        };
      case EscrowStatus.PAID:
        return {
          label: 'Payment Received',
          color: 'bg-blue-100 text-blue-800 border-blue-200',
          icon: CreditCard,
          iconColor: 'text-blue-600'
        };
      case EscrowStatus.SHIPPED:
        return {
          label: 'Item Shipped',
          color: 'bg-purple-100 text-purple-800 border-purple-200',
          icon: Truck,
          iconColor: 'text-purple-600'
        };
      case EscrowStatus.DELIVERED:
        return {
          label: 'Item Delivered',
          color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
          icon: Package,
          iconColor: 'text-indigo-600'
        };
      case EscrowStatus.COMPLETED:
        return {
          label: 'Transaction Completed',
          color: 'bg-green-100 text-green-800 border-green-200',
          icon: CheckCircle,
          iconColor: 'text-green-600'
        };
      case EscrowStatus.DISPUTED:
        return {
          label: 'Dispute Filed',
          color: 'bg-red-100 text-red-800 border-red-200',
          icon: AlertTriangle,
          iconColor: 'text-red-600'
        };
      case EscrowStatus.CANCELLED:
        return {
          label: 'Cancelled',
          color: 'bg-gray-100 text-gray-800 border-gray-200',
          icon: XCircle,
          iconColor: 'text-gray-600'
        };
      default:
        return {
          label: 'Unknown Status',
          color: 'bg-gray-100 text-gray-800 border-gray-200',
          icon: Clock,
          iconColor: 'text-gray-600'
        };
    }
  };

  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  return (
    <Badge 
      variant="outline" 
      className={`${config.color} ${className}`}
    >
      {showIcon && (
        <IconComponent className={`w-3 h-3 mr-1 ${config.iconColor}`} />
      )}
      {config.label}
    </Badge>
  );
}

// Extended component for detailed status display
export function DetailedEscrowStatus({ 
  status, 
  className = '' 
}: EscrowStatusDisplayProps) {
  const config = getStatusConfig(status);
  const IconComponent = config.icon;

  const getStatusDescription = (status: EscrowStatus) => {
    switch (status) {
      case EscrowStatus.PENDING:
        return 'Waiting for buyer to complete payment';
      case EscrowStatus.PAID:
        return 'Payment received, waiting for seller to ship';
      case EscrowStatus.SHIPPED:
        return 'Item is on its way to you';
      case EscrowStatus.DELIVERED:
        return 'Item delivered, please confirm receipt';
      case EscrowStatus.COMPLETED:
        return 'Transaction successfully completed';
      case EscrowStatus.DISPUTED:
        return 'A dispute has been filed for this transaction';
      case EscrowStatus.CANCELLED:
        return 'This transaction has been cancelled';
      default:
        return 'Status unknown';
    }
  };

  return (
    <div className={`flex items-center space-x-3 p-3 rounded-lg border ${config.color} ${className}`}>
      <IconComponent className={`w-5 h-5 ${config.iconColor}`} />
      <div>
        <div className="font-medium">{config.label}</div>
        <div className="text-sm opacity-80">{getStatusDescription(status)}</div>
      </div>
    </div>
  );
}

// Helper function for getStatusConfig
function getStatusConfig(status: EscrowStatus) {
  switch (status) {
    case EscrowStatus.PENDING:
      return {
        label: 'Pending Payment',
        color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        icon: Clock,
        iconColor: 'text-yellow-600'
      };
    case EscrowStatus.PAID:
      return {
        label: 'Payment Received',
        color: 'bg-blue-100 text-blue-800 border-blue-200',
        icon: CreditCard,
        iconColor: 'text-blue-600'
      };
    case EscrowStatus.SHIPPED:
      return {
        label: 'Item Shipped',
        color: 'bg-purple-100 text-purple-800 border-purple-200',
        icon: Truck,
        iconColor: 'text-purple-600'
      };
    case EscrowStatus.DELIVERED:
      return {
        label: 'Item Delivered',
        color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
        icon: Package,
        iconColor: 'text-indigo-600'
      };
    case EscrowStatus.COMPLETED:
      return {
        label: 'Transaction Completed',
        color: 'bg-green-100 text-green-800 border-green-200',
        icon: CheckCircle,
        iconColor: 'text-green-600'
      };
    case EscrowStatus.DISPUTED:
      return {
        label: 'Dispute Filed',
        color: 'bg-red-100 text-red-800 border-red-200',
        icon: AlertTriangle,
        iconColor: 'text-red-600'
      };
    case EscrowStatus.CANCELLED:
      return {
        label: 'Cancelled',
        color: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: XCircle,
        iconColor: 'text-gray-600'
      };
    default:
      return {
        label: 'Unknown Status',
        color: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: Clock,
        iconColor: 'text-gray-600'
      };
  }
}
