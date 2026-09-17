"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageSwiperProps {
  images: string[];
  isOpen: boolean;
  onClose: () => void;
  initialIndex?: number;
}

export function ImageSwiper({ images, isOpen, onClose, initialIndex = 0 }: ImageSwiperProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const lastX = useRef(0);
  const lastTime = useRef(0);
  const velocity = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setDragOffset(0);
    }
  }, [isOpen, initialIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen]);

  const goToPrevious = useCallback(() => {
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setDragOffset(0);
  }, [images.length]);

  const goToNext = useCallback(() => {
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setDragOffset(0);
  }, [images.length]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToNext, goToPrevious]);

  const startDrag = (clientX: number) => {
    setIsAnimating(false);
    setIsDragging(true);
    dragStartX.current = clientX;
    lastX.current = clientX;
    lastTime.current = performance.now();
    velocity.current = 0;
  };

  const moveDrag = (clientX: number) => {
    if (!isDragging) return;

    const now = performance.now();
    const dt = now - lastTime.current;
    if (dt > 0) {
      velocity.current = (clientX - lastX.current) / dt;
    }
    lastX.current = clientX;
    lastTime.current = now;

    let offset = clientX - dragStartX.current;

    const atFirst = currentIndex === 0;
    const atLast = currentIndex === images.length - 1;
    if ((atFirst && offset > 0) || (atLast && offset < 0)) {
      offset = offset * 0.35;
    }

    setDragOffset(offset);
  };

  const endDrag = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const width = containerWidth || 1;
    const distanceRatio = dragOffset / width;
    const flingVelocity = velocity.current;

    setIsAnimating(true);

    const passedThreshold = Math.abs(distanceRatio) > 0.22;
    const flungFast = Math.abs(flingVelocity) > 0.5;

    if ((passedThreshold || flungFast) && dragOffset < 0 && currentIndex < images.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else if ((passedThreshold || flungFast) && dragOffset > 0 && currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }

    setDragOffset(0);
  };

  const handleTouchStart = (e: React.TouchEvent) => startDrag(e.targetTouches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => moveDrag(e.targetTouches[0].clientX);
  const handleTouchEnd = () => endDrag();

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startDrag(e.clientX);
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) moveDrag(e.clientX);
  };
  const handleMouseUp = () => endDrag();
  const handleMouseLeave = () => {
    if (isDragging) endDrag();
  };

  if (!isOpen) return null;

  const baseOffsetPercent = -currentIndex * 100;
  const dragOffsetPercent = containerWidth ? (dragOffset / containerWidth) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 flex items-center justify-center">
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 text-foreground hover:bg-background/20"
      >
        <X className="h-6 w-6" />
      </Button>

      {images.length > 1 && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-foreground hover:bg-background/20"
          >
            <ChevronLeft className="h-8 w-8" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-foreground hover:bg-background/20"
          >
            <ChevronRight className="h-8 w-8" />
          </Button>
        </>
      )}

      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div
          className="flex h-full"
          style={{
            width: `${images.length * 100}%`,
            transform: `translateX(calc(${baseOffsetPercent / images.length}% + ${dragOffsetPercent}%))`,
            transition: isAnimating ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          }}
          onTransitionEnd={() => setIsAnimating(false)}
        >
          {images.map((src, index) => (
            <div
              key={index}
              className="flex items-center justify-center h-full px-10"
              style={{ width: `${100 / images.length}%` }}
            >
              <Image
                src={src}
                alt={`Image ${index + 1}`}
                width={0}
                height={0}
                sizes="100vw"
                draggable={false}
                priority={index === currentIndex}
                style={{
                  width: 'auto',
                  height: 'auto',
                  maxWidth: '100%',
                  maxHeight: '90vh',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 text-foreground px-3 py-1 rounded-full text-sm">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {images.length > 1 && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                setIsAnimating(true);
                setCurrentIndex(index);
                setDragOffset(0);
              }}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                index === currentIndex ? "bg-background" : "bg-background/50"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}