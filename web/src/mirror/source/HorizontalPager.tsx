import {
  Children,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  clampPagerIndex,
  pagerAxis,
  pagerDragOffset,
  pagerVelocity,
  PAGER_TOKENS,
  releasedPagerIndex,
  type PagerAxis,
  type PointerSample,
} from "./horizontalPagerMotion";
import "./horizontal-pager.css";

type PagerContent<T> =
  | {
      children: ReactNode;
      items?: never;
      renderItem?: never;
      getItemKey?: never;
    }
  | {
      items: readonly T[];
      renderItem: (item: T, index: number) => ReactNode;
      getItemKey?: (item: T, index: number) => string | number;
      children?: never;
    };
export type HorizontalPagerProps<T = never> = PagerContent<T> & {
  index: number;
  onIndexChange: (index: number) => void;
  label: string;
  className?: string;
  peek?: number;
  gap?: number;
  showControls?: boolean;
  style?: CSSProperties;
  /** Pointer contact and keyboard/form focus; useful for deferring an automatic tray collapse. */
  onInteractionChange?: (active: boolean) => void;
};
type Gesture = {
  id: number;
  startX: number;
  startY: number;
  index: number;
  axis: PagerAxis;
  dx: number;
  moved: boolean;
  samples: PointerSample[];
};

const editable =
  'input,select,textarea,[contenteditable="true"],[data-pager-no-drag]';
/** Browsing only. A child's native click/Enter/Space is the sole selection path. */
export function HorizontalPager<T = never>(props: HorizontalPagerProps<T>) {
  const {
    index,
    onIndexChange,
    label,
    className = "",
    peek = PAGER_TOKENS.peek,
    gap = PAGER_TOKENS.gap,
    showControls = true,
    style,
    onInteractionChange,
  } = props;
  const pages =
    props.items !== undefined
      ? props.items.map((item, i) => ({
          key: props.getItemKey?.(item, i) ?? i,
          node: props.renderItem(item, i),
        }))
      : Children.toArray(props.children).map((node, i) => ({
          key:
            typeof node === "object" && node !== null && "key" in node
              ? (node.key ?? i)
              : i,
          node,
        }));
  const count = pages.length,
    current = clampPagerIndex(index, count);
  const safePeek = Math.max(0, Math.min(0.25, peek)),
    safeGap = Math.max(0, gap);
  const root = useRef<HTMLElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0),
    [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null),
    suppression = useRef(0),
    clearSuppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerContacts = useRef(new Set<number>());
  const keyboardFocus = useRef(false),
    interactionActive = useRef(false),
    callback = useRef(onInteractionChange);
  callback.current = onInteractionChange;
  const currentRef = useRef(current);
  currentRef.current = current;
  const cardWidth = Math.max(
    0,
    width * (1 - safePeek) - (safePeek > 0 ? safeGap : 0),
  );
  const geometry = useRef({ card: 0, step: 0, count });
  geometry.current = { card: cardWidth, step: cardWidth + safeGap, count };
  const hintId = useId();
  const notifyInteraction = () => {
    const active =
      Boolean(gesture.current) ||
      pointerContacts.current.size > 0 ||
      keyboardFocus.current;
    if (active !== interactionActive.current) {
      interactionActive.current = active;
      callback.current?.(active);
    }
  };
  const suppressNextClick = () => {
    suppression.current = performance.now() + 800;
    if (clearSuppressionTimer.current)
      clearTimeout(clearSuppressionTimer.current);
    clearSuppressionTimer.current = setTimeout(() => {
      suppression.current = 0;
      clearSuppressionTimer.current = null;
    }, 800);
  };
  const releaseCapture = (id: number) => {
    const element = viewport.current;
    try {
      if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
    } catch {
      /* A browser may already have canceled this pointer. */
    }
  };
  const settleVisual = () => {
    if (root.current) root.current.dataset.dragging = "false";
    if (track.current) track.current.style.transition = "";
    setDragging(false);
  };
  const cancelGesture = (suppress = true) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (suppress) suppressNextClick();
    releaseCapture(active.id);
    settleVisual();
    notifyInteraction();
    if (track.current)
      track.current.style.transform = `translate3d(${-currentRef.current * geometry.current.step}px,0,0)`;
  };
  const cancelRef = useRef(cancelGesture);
  cancelRef.current = cancelGesture;

  useLayoutEffect(() => {
    const active = gesture.current;
    if (active && active.index !== current) cancelRef.current(true);
    if (!gesture.current && track.current)
      track.current.style.transform = `translate3d(${-current * geometry.current.step}px,0,0)`;
    const focused = document.activeElement;
    const hiddenFocus =
      focused instanceof Element &&
      focused
        .closest(".horizontal-pager__page")
        ?.getAttribute("data-page-index") !== String(current);
    if (
      focused &&
      viewport.current?.contains(focused) &&
      focused !== viewport.current &&
      hiddenFocus
    )
      viewport.current.focus({ preventScroll: true });
  }, [current, width, dragging, count, safePeek, safeGap]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let previous = -1,
      animation = 0;
    const resize = () => {
      const next = element.getBoundingClientRect().width;
      if (Math.abs(next - previous) < 0.25) return;
      previous = next;
      cancelRef.current(true);
      if (track.current) track.current.style.transition = "none";
      setWidth(next);
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        animation = requestAnimationFrame(() => {
          if (track.current) track.current.style.transition = "";
        });
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animation);
    };
  }, []);
  useEffect(() => {
    const outsideEnd = (event: globalThis.PointerEvent) => {
      pointerContacts.current.delete(event.pointerId);
      if (
        gesture.current?.id === event.pointerId &&
        !viewport.current?.contains(event.target as Node)
      )
        cancelRef.current(true);
      notifyInteraction();
    };
    const leave = () => {
      pointerContacts.current.clear();
      keyboardFocus.current = false;
      cancelRef.current(true);
      notifyInteraction();
    };
    window.addEventListener("pointerup", outsideEnd);
    window.addEventListener("pointercancel", leave);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("pointerup", outsideEnd);
      window.removeEventListener("pointercancel", leave);
      window.removeEventListener("blur", leave);
      const active = gesture.current;
      gesture.current = null;
      if (active) releaseCapture(active.id);
      if (clearSuppressionTimer.current)
        clearTimeout(clearSuppressionTimer.current);
      if (interactionActive.current) {
        interactionActive.current = false;
        callback.current?.(false);
      }
    };
  }, []);
  const pageIdentity = pages.map((page) => String(page.key)).join("|");
  useLayoutEffect(() => {
    cancelRef.current(true);
  }, [count, label, pageIdentity]);

  const browse = (next: number) => {
    const bounded = clampPagerIndex(next, count);
    if (bounded !== current) {
      cancelGesture(true);
      onIndexChange(bounded);
    }
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) {
      cancelGesture(true);
      return;
    }
    if (event.button !== 0 || count < 1) return;
    cancelGesture(false);
    suppression.current = 0;
    if (clearSuppressionTimer.current) {
      clearTimeout(clearSuppressionTimer.current);
      clearSuppressionTimer.current = null;
    }
    keyboardFocus.current = false;
    if ((event.target as Element).closest(editable)) {
      notifyInteraction();
      return;
    }
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      index: current,
      axis: "pending",
      dx: 0,
      moved: false,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
    notifyInteraction();
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.startX,
      dy = event.clientY - active.startY;
    active.dx = dx;
    active.moved ||= Math.hypot(dx, dy) > PAGER_TOKENS.dragThreshold;
    if (active.axis === "pending") active.axis = pagerAxis(dx, dy);
    if (active.axis !== "horizontal") return;
    active.samples.push({ x: event.clientX, time: event.timeStamp });
    active.samples = active.samples.filter(
      (sample) =>
        sample.time >= event.timeStamp - PAGER_TOKENS.velocityWindowMs,
    );
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic pointer tests may not have a native capture target. */
      }
    }
    if (root.current) root.current.dataset.dragging = "true";
    if (track.current) track.current.style.transition = "none";
    setDragging(true);
    const offset = pagerDragOffset(
      dx,
      active.index,
      count,
      geometry.current.card,
    );
    if (track.current)
      track.current.style.transform = `translate3d(${-active.index * geometry.current.step + offset}px,0,0)`;
    // Native vertical panning and pinch zoom remain available; only a confirmed horizontal drag is owned.
    if (event.cancelable) event.preventDefault();
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    if (active.moved || active.axis !== "pending") suppressNextClick();
    releaseCapture(active.id);
    settleVisual();
    notifyInteraction();
    const next =
      active.axis === "horizontal"
        ? releasedPagerIndex({
            index: active.index,
            count,
            dx: active.dx,
            velocity: pagerVelocity(active.samples, event.timeStamp),
            cardWidth: geometry.current.card,
          })
        : active.index;
    if (next !== current) onIndexChange(next);
    // A no-state-change short/vertical gesture still returns to the controlled page.
    if (track.current)
      track.current.style.transform = `translate3d(${-next * geometry.current.step}px,0,0)`;
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(editable)) return;
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      keyboardFocus.current = true;
      notifyInteraction();
      browse(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? count - 1
            : current + (event.key === "ArrowRight" ? 1 : -1),
      );
      return;
    }
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target === event.currentTarget
    ) {
      const page = event.currentTarget.querySelector<HTMLElement>(
        `[data-page-index="${current}"]`,
      );
      const choice = page?.querySelector<HTMLElement>(
        '[data-pager-select],button:not(:disabled),a[href],[role="button"]',
      );
      if (choice) {
        event.preventDefault();
        suppression.current = 0;
        choice.click();
      }
    }
  };
  return (
    <section
      ref={root}
      className={`horizontal-pager ${className}`}
      aria-label={label}
      data-browsed-index={current}
      data-dragging={dragging}
      style={
        {
          ...style,
          "--pager-gap": `${safeGap}px`,
          "--pager-card-width": width
            ? `${geometry.current.card}px`
            : `${(1 - safePeek) * 100}%`,
          "--pager-settle-ms": `${PAGER_TOKENS.settleMs}ms`,
        } as CSSProperties
      }
      onPointerDownCapture={(event) => {
        pointerContacts.current.add(event.pointerId);
        keyboardFocus.current = false;
        notifyInteraction();
      }}
      onPointerUpCapture={(event) => {
        pointerContacts.current.delete(event.pointerId);
        notifyInteraction();
      }}
      onPointerCancelCapture={(event) => {
        pointerContacts.current.delete(event.pointerId);
        notifyInteraction();
      }}
      onFocusCapture={(event) => {
        if ((event.target as Element).matches(":focus-visible")) {
          keyboardFocus.current = true;
          notifyInteraction();
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          keyboardFocus.current = false;
          notifyInteraction();
        }
      }}
    >
      <div
        ref={viewport}
        className="horizontal-pager__viewport"
        tabIndex={count ? 0 : -1}
        aria-describedby={hintId}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => cancelGesture(true)}
        onLostPointerCapture={() => cancelGesture(true)}
        onKeyDown={keyDown}
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (event.detail !== 0 && performance.now() < suppression.current) {
            event.preventDefault();
            event.stopPropagation();
            suppression.current = 0;
          }
        }}
      >
        <div ref={track} className="horizontal-pager__track">
          {pages.map((page, i) => (
            <div
              key={page.key}
              className="horizontal-pager__page"
              data-page-index={i}
              role="group"
              aria-roledescription="슬라이드"
              aria-label={`${i + 1} / ${count}`}
              aria-hidden={i !== current}
              inert={i !== current}
            >
              {page.node}
            </div>
          ))}
        </div>
      </div>
      <span id={hintId} className="horizontal-pager__sr-only">
        좌우 방향키로 살펴보고 Enter 또는 Space로 선택할 수 있습니다.
      </span>
      {showControls && count > 1 && (
        <div className="horizontal-pager__controls">
          <button
            type="button"
            aria-label={`${label} 이전`}
            disabled={current === 0}
            onClick={() => browse(current - 1)}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="m12 4-6 6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span aria-live="polite" aria-atomic="true">
            {current + 1} / {count}
          </span>
          <button
            type="button"
            aria-label={`${label} 다음`}
            disabled={current === count - 1}
            onClick={() => browse(current + 1)}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="m8 4 6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
