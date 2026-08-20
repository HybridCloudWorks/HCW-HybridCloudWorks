import React, { useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import { resolveMediaUrl } from '../../lib/functionsBase';

/**
 * Interactive Diagram Component
 * Features: Zoom, Pan, Pinch, and Interactive Hotspots.
 * Hotspots display details in a "lower part" panel when clicked.
 */
export default function InteractiveDiagram({ imageUrl, hotspots = [], onHotspotClick }) {
  const [activeHotspot, setActiveHotspot] = useState(null);

  const handleHotspotClick = (hotspot) => {
    setActiveHotspot(hotspot);
    if (onHotspotClick) onHotspotClick(hotspot);
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-2 border-muted relative group">
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {/* Controls will be injected via render props if needed, or we can use ref */}
          <div className="bg-background/80 backdrop-blur rounded-md p-1 shadow-sm border">
            <p className="text-[10px] text-center font-mono text-muted-foreground px-1">
              Interactive
            </p>
          </div>
        </div>

        <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit>
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              {/* Floating Toolbar */}
              <div className="absolute bottom-4 right-4 z-10 flex gap-2">
                <Button size="icon" variant="secondary" onClick={() => zoomIn()} title="Zoom In">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="secondary" onClick={() => zoomOut()} title="Zoom Out">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => resetTransform()}
                  title="Reset"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              <TransformComponent
                wrapperClass="w-full h-[500px] bg-muted/10 cursor-grab active:cursor-grabbing"
                contentClass="w-full h-full"
              >
                <div className="relative w-full h-full flex items-center justify-center">
                  <img
                    src={resolveMediaUrl(imageUrl)}
                    alt="Architecture Diagram"
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-full object-contain pointer-events-none select-none"
                  />

                  {/* Hotspots Layer */}
                  {hotspots.map((spot) => (
                    <motion.button
                      key={spot.id}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      whileHover={{ scale: 1.2 }}
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent drag start
                        handleHotspotClick(spot);
                      }}
                      className={`absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-white shadow-lg flex items-center justify-center z-20 ${
                        activeHotspot?.id === spot.id ? 'bg-primary animate-pulse' : 'bg-blue-500'
                      }`}
                      style={{ top: `${spot.y}%`, left: `${spot.x}%` }}
                      title={spot.label}
                    >
                      <span className="sr-only">{spot.label}</span>
                    </motion.button>
                  ))}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </Card>

      {/* Details Panel (Lower Part) */}
      <AnimatePresence mode="wait">
        {activeHotspot ? (
          <motion.div
            key={activeHotspot.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="border-l-4 border-l-primary bg-accent/10">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-xl font-bold text-primary">{activeHotspot.label}</h3>
                  <Button variant="ghost" size="sm" onClick={() => setActiveHotspot(null)}>
                    Close
                  </Button>
                </div>
                <p className="text-muted-foreground">{activeHotspot.description}</p>
                {activeHotspot.link && (
                  <Button variant="link" className="px-0 mt-2" asChild>
                    <a href={activeHotspot.link} target="_blank" rel="noopener noreferrer">
                      Learn More &rarr;
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-32 flex items-center justify-center text-muted-foreground border border-dashed rounded-lg bg-muted/20"
          >
            <p className="flex items-center gap-2">
              <Maximize className="h-4 w-4" /> Click a hotspot on the diagram for details.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
