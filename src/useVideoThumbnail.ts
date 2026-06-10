import { useEffect, useState } from "react";

export function useVideoThumbnail(src: string, seekTime = 1.5) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setDataUrl(null);
    if (!src) return;

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(seekTime, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      if (disposed) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setDataUrl(canvas.toDataURL("image/jpeg", 0.86));
        } catch {
          setDataUrl(null);
        }
      }
    });

    video.addEventListener("error", () => {
      if (!disposed) setDataUrl(null);
    });

    video.src = src;
    return () => {
      disposed = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, seekTime]);

  return dataUrl;
}
