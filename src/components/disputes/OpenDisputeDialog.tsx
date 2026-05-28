"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Upload, X, Loader2 } from 'lucide-react';
import { DisputeService, DisputeEvidence } from '@/lib/dispute-service';
import { StorageService } from '@/lib/storage-service';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-supabase-auth';

interface OpenDisputeDialogProps {
  transactionId: string;
  children: React.ReactNode;
}

const disputeReasons = [
  { value: 'item_not_received', label: 'Item not received' },
  { value: 'item_different', label: 'Item different from description' },
  { value: 'item_damaged', label: 'Item arrived damaged' },
  { value: 'seller_unresponsive', label: 'Seller not responding' },
  { value: 'payment_issue', label: 'Payment issue' },
  { value: 'delivery_issue', label: 'Delivery problem' },
  { value: 'other', label: 'Other' },
];

export function OpenDisputeDialog({ transactionId, children }: OpenDisputeDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [description, setDescription] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [fileUrls, setFileUrls] = useState<string[]>([]);

  const handleFileUpload = async (files: FileList) => {
    const newFiles = Array.from(files);
    const validFiles = newFiles.filter(file => {
      const isValidType = file.type.startsWith('image/') || file.type === 'application/pdf';
      const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB limit
      return isValidType && isValidSize;
    });

    if (validFiles.length !== newFiles.length) {
      toast({
        title: "Invalid Files",
        description: "Some files were skipped. Only images and PDFs under 10MB are allowed.",
        variant: "destructive",
      });
    }

    setUploadedFiles(prev => [...prev, ...validFiles]);
    setIsLoading(true);

    try {
      const uploadPromises = validFiles.map(async (file) => {
        const { url, error } = await StorageService.uploadDisputeEvidence(transactionId, file);
        if (error || !url) {
          throw new Error('Failed to upload file');
        }
        return url;
      });

      const newUrls = await Promise.all(uploadPromises);
      setFileUrls(prev => [...prev, ...newUrls]);
    } catch (error) {
      console.error('File upload error:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload some files. Please try again.",
        variant: "destructive",
      });
      // Revert uploaded files since upload failed
      setUploadedFiles(prev => prev.slice(0, prev.length - validFiles.length));
    } finally {
      setIsLoading(false);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setFileUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "Please log in to open a dispute.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedReason || !description.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a reason and provide a description.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const evidence: DisputeEvidence = {
        photos: fileUrls,
        description: description.trim(),
        additionalNotes: additionalNotes.trim() || undefined,
      };

      await DisputeService.openDispute(
        transactionId,
        user.id,
        selectedReason,
        evidence
      );

      toast({
        title: "Dispute Opened",
        description: "Your dispute has been submitted and will be reviewed by our support team.",
      });

      setIsOpen(false);
      resetForm();
    } catch (error) {
      console.error('Error opening dispute:', error);
      toast({
        title: "Error",
        description: "Failed to open dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedReason('');
    setDescription('');
    setAdditionalNotes('');
    setUploadedFiles([]);
    setFileUrls([]);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      resetForm();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Open Dispute
          </DialogTitle>
          <DialogDescription>
            Please provide details about the issue you&apos;re experiencing with this transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Dispute Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Dispute *</Label>
            <Select value={selectedReason} onValueChange={setSelectedReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {disputeReasons.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Please describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-sm text-muted-foreground">
              Be as specific as possible. Include dates, times, and any relevant details.
            </p>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label>Evidence (Optional)</Label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 mb-2">
                Upload photos or documents as evidence
              </p>
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                className="hidden"
                id="file-upload"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                Choose Files
              </Button>
              <p className="text-xs text-gray-500 mt-2">
                Images and PDFs only. Max 10MB per file.
              </p>
            </div>

            {/* Uploaded Files */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <Label>Uploaded Files</Label>
                <div className="space-y-2">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center">
                          📄
                        </div>
                        <div>
                          <p className="text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-gray-500">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Additional Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional information that might help resolve this dispute..."
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Warning */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Important:</strong> Opening a dispute will freeze the transaction funds until resolved. 
              Please ensure you&apos;ve tried to resolve the issue with the other party first.
            </AlertDescription>
          </Alert>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !selectedReason || !description.trim()}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Open Dispute'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
