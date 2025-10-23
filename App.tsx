import React, { useState, useEffect, useRef, useCallback } from 'react';

// TypeScript declarations for libraries loaded via CDN
declare const JSZip: any;
declare const saveAs: any;

// --- Icon Components ---
const UploadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const CutIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.412 10.588L10.588 14.412m5.656-5.656a8 8 0 10-11.314 11.314m11.314-11.314a8 8 0 00-11.314 11.314" />
    <circle cx="6.5" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="2" />
    <circle cx="17.5" cy="17.5" r="2.5" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

const EqualizeIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 20.25v-4.5m0 4.5h-4.5m4.5 0L15 15m-6 0L3.75 20.25m9-9l6.75-6.75" />
    </svg>
);


const SpinnerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);


// --- Main App Component ---
export default function App() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [slicedImages, setSlicedImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isEqualizing, setIsEqualizing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());


  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when a new file is uploaded
  const resetState = () => {
    setImageUrl(null);
    setImageDimensions(null);
    setSlicedImages([]);
    setError(null);
    setBackgroundColor(null);
    setSelectionMode(false);
    setSelectedIndices(new Set());
  };

  useEffect(() => {
    if (!imageFile) {
      resetState();
      return;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      setImageUrl(objectUrl);
    };
    img.src = objectUrl;


    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);


  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      resetState();
      setImageFile(e.target.files[0]);
    }
  };


  const handleSlice = useCallback(async () => {
    if (!imageUrl || !imageDimensions) return;

    setIsLoading(true);
    setError(null);
    setSlicedImages([]);
    setBackgroundColor(null);
    setSelectedIndices(new Set());
    setSelectionMode(false);

    // Use a worker for heavy computation to avoid freezing the UI
    const workerCode = `
      self.onmessage = function(event) {
        const { imageData, width, height } = event.data;
        const data = imageData.data;

        // 1. Find the most common color (background color)
        const colorCounts = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // Ignore mostly transparent pixels
          const color = \`\${data[i]},\${data[i + 1]},\${data[i + 2]}\`; // Ignore alpha for grouping
          colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
        }

        let maxCount = 0;
        let bgColorStr = '0,0,0';
        for (const [color, count] of colorCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            bgColorStr = color;
          }
        }
        const bgColorArr = bgColorStr.split(',').map(Number);
        const bgColor = { r: bgColorArr[0], g: bgColorArr[1], b: bgColorArr[2] };
        
        self.postMessage({ type: 'bgColor', payload: \`rgb(\${bgColor.r}, \${bgColor.g}, \${bgColor.b})\` });

        // 2. Find bounding boxes of non-background pixel groups (Connected Component Labeling via BFS)
        const visited = new Array(width * height).fill(false);
        const boundingBoxes = [];

        const isBg = (i) => data[i] === bgColor.r && data[i+1] === bgColor.g && data[i+2] === bgColor.b;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i1D = y * width + x;
            if (visited[i1D] || isBg(i1D * 4) || data[(i1D * 4) + 3] === 0) continue;

            const queue = [[x, y]];
            visited[i1D] = true;
            let minX = x, minY = y, maxX = x, maxY = y;

            while (queue.length > 0) {
              const [cx, cy] = queue.shift();
              minX = Math.min(minX, cx); minY = Math.min(minY, cy);
              maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy);

              const neighbors = [[cx, cy - 1], [cx, cy + 1], [cx - 1, cy], [cx + 1, cy]];
              for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const n1D = ny * width + nx;
                  if (!visited[n1D] && !isBg(n1D * 4) && data[(n1D * 4) + 3] > 0) {
                    visited[n1D] = true;
                    queue.push([nx, ny]);
                  }
                }
              }
            }
            // Add a small threshold to avoid detecting tiny noise as sprites
            if ((maxX - minX + 1) > 4 && (maxY - minY + 1) > 4) {
                boundingBoxes.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
            }
          }
        }
        self.postMessage({ type: 'boxes', payload: boundingBoxes });
        self.close();
      };
    `;
    const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            setError("Could not get canvas context.");
            setIsLoading(false);
            return;
        }
        canvas.width = imageDimensions.width;
        canvas.height = imageDimensions.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, imageDimensions.width, imageDimensions.height);

        worker.postMessage({ imageData, width: imageDimensions.width, height: imageDimensions.height });
    };
    img.onerror = () => {
      setError("Failed to load image for slicing. It may be corrupted.");
      setIsLoading(false);
    };
    
    worker.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'bgColor') {
            setBackgroundColor(payload);
        }
        if (type === 'boxes') {
            const cropCanvas = document.createElement('canvas');
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) {
                setError("Could not create cropping canvas.");
                setIsLoading(false);
                return;
            }

            const newSprites: string[] = [];
            for (const box of payload) {
                cropCanvas.width = box.width;
                cropCanvas.height = box.height;
                cropCtx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
                newSprites.push(cropCanvas.toDataURL('image/png'));
            }
            setSlicedImages(newSprites);
            setIsLoading(false);
            URL.revokeObjectURL(workerUrl);
        }
    };
    
    worker.onerror = (e) => {
        setError(`An error occurred in the slicing worker: ${e.message}`);
        setIsLoading(false);
        URL.revokeObjectURL(workerUrl);
    }
    
    img.src = imageUrl;
  }, [imageUrl, imageDimensions]);

  const handleDownloadAll = useCallback(async () => {
    if (slicedImages.length === 0) return;

    try {
      const zip = new JSZip();
      slicedImages.forEach((dataUrl, index) => {
        const base64Data = dataUrl.split(',')[1];
        if (base64Data) {
          zip.file(`sprite_${index}.png`, base64Data, { base64: true });
        }
      });

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, 'sprites.zip');
    } catch (err) {
      console.error("Error creating zip file:", err);
      setError("Failed to create ZIP file. Check browser console for details.");
    }

  }, [slicedImages]);
  
  const handleToggleSelection = (index: number) => {
    if (!selectionMode) return;
    const newSelection = new Set(selectedIndices);
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
    setSelectedIndices(newSelection);
  };

  const handleEqualizeSizes = async () => {
    if (selectedIndices.size < 2) return;
    setIsEqualizing(true);
    
    const imagePromises = Array.from(selectedIndices).map(index => {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = slicedImages[index];
      });
    });

    try {
      const loadedImages = await Promise.all(imagePromises);
      const maxWidth = Math.max(...loadedImages.map(img => img.width));
      const maxHeight = Math.max(...loadedImages.map(img => img.height));

      const newSlicedImages = [...slicedImages];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError("Canvas context not available for equalization.");
        setIsEqualizing(false);
        return;
      }
      canvas.width = maxWidth;
      canvas.height = maxHeight;

      Array.from(selectedIndices).forEach((originalIndex, i) => {
        const img = loadedImages[i];
        ctx.clearRect(0, 0, maxWidth, maxHeight);
        const dx = (maxWidth - img.width) / 2;
        const dy = (maxHeight - img.height) / 2;
        ctx.drawImage(img, dx, dy);
        newSlicedImages[originalIndex] = canvas.toDataURL('image/png');
      });

      setSlicedImages(newSlicedImages);
      setSelectedIndices(new Set());
      setSelectionMode(false);

    } catch (e) {
      setError("Failed to load one of the selected sprites for processing.");
    } finally {
        setIsEqualizing(false);
    }
  };


  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col lg:flex-row font-sans">
      {/* --- Control Panel --- */}
      <aside className="w-full lg:w-80 xl:w-96 bg-gray-800 p-6 shadow-2xl flex flex-col space-y-6 shrink-0">
        <div className="flex items-center space-x-3">
          <CutIcon className="w-8 h-8 text-cyan-400" />
          <h1 className="text-2xl font-bold text-gray-100">Smart Slicer</h1>
        </div>
        <p className="text-gray-400 text-sm">Upload a spritesheet to automatically detect and extract individual sprites.</p>

        <div className="flex-grow flex flex-col space-y-6">
          {/* Step 1: Upload */}
          <div className="space-y-2">
            <label className="text-gray-300 font-semibold">1. Upload Image</label>
            <input type="file" accept="image/*" onChange={handleImageUpload} ref={fileInputRef} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg border-2 border-dashed border-gray-500 hover:border-cyan-400 transition-all duration-300 text-gray-300">
              <UploadIcon className="w-6 h-6" />
              <span>{imageFile ? imageFile.name : 'Choose a spritesheet'}</span>
            </button>
          </div>

          {imageUrl && (
            <>
              {backgroundColor && (
                 <div className="space-y-2 p-3 bg-gray-900/50 rounded-lg border border-gray-700 text-sm">
                    <p className="text-gray-400">Detected Background:</p>
                    <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded border border-gray-500" style={{ backgroundColor: backgroundColor }}></div>
                        <span className="text-gray-300 font-mono text-xs">{backgroundColor}</span>
                    </div>
                 </div>
              )}
              {/* Step 2: Slice */}
              <button onClick={handleSlice} disabled={isLoading || isEqualizing} className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-bold text-white transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed">
                {isLoading ? <SpinnerIcon className="w-6 h-6 animate-spin" /> : <CutIcon className="w-6 h-6" />}
                <span>{isLoading ? 'Extracting...' : '2. Extract Sprites'}</span>
              </button>
            </>
          )}

          {slicedImages.length > 0 && (
            <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 space-y-4">
                <label htmlFor="selectionModeToggle" className="flex items-center justify-between cursor-pointer">
                    <span className="font-semibold text-gray-300">Selection Mode</span>
                    <div className="relative">
                        <input type="checkbox" id="selectionModeToggle" className="sr-only" checked={selectionMode} onChange={(e) => {
                            setSelectionMode(e.target.checked);
                            if (!e.target.checked) setSelectedIndices(new Set());
                        }} />
                        <div className="block bg-gray-600 w-14 h-8 rounded-full"></div>
                        <div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${selectionMode ? 'transform translate-x-6 bg-cyan-400' : ''}`}></div>
                    </div>
                </label>
                {selectedIndices.size > 1 && (
                    <button onClick={handleEqualizeSizes} disabled={isEqualizing} className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold text-white transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed">
                        {isEqualizing ? <SpinnerIcon className="w-5 h-5 animate-spin" /> : <EqualizeIcon className="w-5 h-5" />}
                        <span>{isEqualizing ? 'Processing...' : `Equalize Size (${selectedIndices.size})`}</span>
                    </button>
                )}
            </div>
          )}

          {error && <div className="bg-red-900 border border-red-700 text-red-200 p-3 rounded-md text-sm">{error}</div>}
        </div>

        {slicedImages.length > 0 && (
          <button onClick={handleDownloadAll} className="w-full flex items-center justify-center space-x-2 px-4 py-3 mt-auto bg-green-600 hover:bg-green-500 rounded-lg font-bold text-white transition-all duration-300">
            <DownloadIcon className="w-6 h-6" />
            <span>Download All ({slicedImages.length} sprites)</span>
          </button>
        )}
      </aside>

      {/* --- Display Area --- */}
      <main className="flex-1 p-6 lg:p-10 bg-gray-900 flex items-center justify-center relative overflow-auto">
        {(isLoading && !slicedImages.length) && (
          <div className="absolute inset-0 bg-gray-900 bg-opacity-75 flex flex-col items-center justify-center z-20">
            <SpinnerIcon className="w-16 h-16 animate-spin text-cyan-400" />
            <p className="mt-4 text-lg">Analyzing and extracting sprites...</p>
          </div>
        )}

        {!imageUrl && (
          <div className="text-center text-gray-500">
            <h2 className="text-3xl font-bold">Welcome!</h2>
            <p className="mt-2">Upload a spritesheet to get started.</p>
          </div>
        )}

        <div className="w-full h-full">
          {slicedImages.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
              {slicedImages.map((spriteSrc, index) => {
                const isSelected = selectedIndices.has(index);
                const itemClass = `
                  block relative group aspect-square bg-white/5 rounded-md overflow-hidden
                  border-2 transition-all duration-200
                  ${selectionMode ? 'cursor-pointer' : ''}
                  ${isSelected ? 'border-cyan-500 ring-2 ring-cyan-500' : 'border-transparent'}
                  ${!isSelected && selectionMode ? 'hover:border-gray-500' : ''}
                  ${!selectionMode ? 'hover:border-cyan-500' : ''}
                `;
                return (
                  <div key={index} className={itemClass} onClick={() => handleToggleSelection(index)}>
                    <img src={spriteSrc} alt={`Sprite ${index}`} className="w-full h-full object-contain" />
                    {!selectionMode && (
                        <a href={spriteSrc} download={`sprite_${index}.png`} className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
                            <DownloadIcon className="w-8 h-8 text-white" />
                        </a>
                    )}
                     {isSelected && (
                        <div className="absolute top-1 right-1 w-5 h-5 bg-cyan-500 rounded-full flex items-center justify-center border-2 border-gray-800">
                           <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
                        </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : imageUrl && (
            <div className="w-full h-full flex items-center justify-center p-4 border-2 border-dashed border-gray-700 rounded-lg">
              <img src={imageUrl} alt="Spritesheet Preview" className="max-w-full max-h-full object-contain select-none" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
