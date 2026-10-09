'use client';

import { useState } from 'react';
import { AccessoryStep } from '@/app/(app)/studio/accessory-step';
import { SelectGridModal } from '@/app/(app)/studio/select-modal';
import { SectionHead, SelCard, sectionCardStyle } from '@/app/(app)/studio/shared-cards';
import { C } from '@/components/tokens';
import type { BackgroundItem, CatalogItem, FaceItem, PoseItem } from './use-fabric-to-shoot';

interface AccessoryCategory {
  id: number;
  label: string;
  items: CatalogItem[];
}

// Steps 3+ of the single-page flow, rendered directly below
// FabricToShootSection (steps 1-2) as soon as the selected preset is
// linked to a Studio garment type — same face/background/pose(/lower/shoes/
// accessory) flow Studio's own page uses, with gender and garment type coming
// from the selected preset rather than a separate pick here. The submit
// button at the bottom is the page's ONE action: it runs the fabric job
// first, then — once it completes — feeds the result into the tryon job
// with whatever was picked here, all behind a single click. Reuses Studio's
// exported SectionHead/SelCard/sectionCardStyle/AccessoryStep/SelectGridModal
// pieces exactly as embed-studio-wizard.tsx already does, so it looks and
// behaves like the real wizard without importing or touching studio/page.tsx
// itself.
export function FabricToShootStudioFlow({
  faces,
  faceId,
  onSelectFace,
  backgrounds,
  backgroundId,
  onSelectBackground,
  poses,
  poseIds,
  onTogglePose,
  needsLower,
  needsShoes,
  needsAccessory,
  lowerItems,
  lowerCatalogId,
  onSelectLower,
  shoeItems,
  shoeCatalogId,
  onSelectShoe,
  accessoryCategories,
  accessoryCatalogIds,
  onToggleAccessory,
}: {
  faces: FaceItem[];
  faceId: string | null;
  onSelectFace: (id: string) => void;
  backgrounds: BackgroundItem[];
  backgroundId: string | null;
  onSelectBackground: (id: string) => void;
  poses: PoseItem[];
  poseIds: string[];
  onTogglePose: (id: string) => void;
  needsLower: boolean;
  needsShoes: boolean;
  needsAccessory: boolean;
  lowerItems: CatalogItem[];
  lowerCatalogId: string | null;
  onSelectLower: (id: string | null) => void;
  shoeItems: CatalogItem[];
  shoeCatalogId: string | null;
  onSelectShoe: (id: string | null) => void;
  accessoryCategories: AccessoryCategory[];
  accessoryCatalogIds: string[];
  onToggleAccessory: (categoryId: number, itemId: string) => void;
}): React.ReactElement {
  const [faceModalOpen, setFaceModalOpen] = useState(false);
  const [backgroundModalOpen, setBackgroundModalOpen] = useState(false);
  const [poseModalOpen, setPoseModalOpen] = useState(false);
  const [lowerModalOpen, setLowerModalOpen] = useState(false);
  const [shoeModalOpen, setShoeModalOpen] = useState(false);

  // Lower/shoes are conditional — number them relative to the fixed steps
  // only when shown, same pattern as Studio's own stepNumberOf.
  const extraStepKeys = [needsLower && 'lower', needsShoes && 'shoes'].filter(
    (key): key is string => !!key,
  );
  const stepNumberOf = (key: string) => 7 + extraStepKeys.indexOf(key);
  const accessoryStepNumber = 7 + extraStepKeys.length;

  return (
    <>
      <div style={sectionCardStyle}>
        <SectionHead
          title="Model face"
          stepNumber={4}
          right={
            faces.length > 5 && (
              <button
                type="button"
                onClick={() => setFaceModalOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.pink,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View all
              </button>
            )
          }
        />
        <div className="studio-5col-grid">
          {faces.slice(0, 5).map((f) => (
            <SelCard
              key={f.id}
              selected={faceId === f.id}
              onClick={() => onSelectFace(f.id)}
              imageUrl={f.thumbnailUrl}
              w="100%"
              ratio={215.2 / 212.67}
            />
          ))}
        </div>
      </div>

      <div style={sectionCardStyle}>
        <SectionHead
          title="Background"
          stepNumber={5}
          right={
            backgrounds.length > 5 && (
              <button
                type="button"
                onClick={() => setBackgroundModalOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.pink,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View all
              </button>
            )
          }
        />
        <div className="studio-5col-grid">
          {backgrounds.slice(0, 5).map((b) => (
            <SelCard
              key={b.id}
              selected={backgroundId === b.id}
              onClick={() => onSelectBackground(b.id)}
              imageUrl={b.thumbnailUrl}
              w="100%"
              ratio={215.2 / 212.67}
            />
          ))}
        </div>
      </div>

      <div style={sectionCardStyle}>
        <SectionHead
          title="Pose(s)"
          subtitle="Select one or more — each becomes its own generated photo"
          stepNumber={6}
          right={
            poses.length > 5 && (
              <button
                type="button"
                onClick={() => setPoseModalOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.pink,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View all
              </button>
            )
          }
        />
        <div className="studio-5col-grid">
          {poses.slice(0, 5).map((p) => (
            <SelCard
              key={p.id}
              selected={poseIds.includes(p.id)}
              onClick={() => onTogglePose(p.id)}
              imageUrl={p.thumbnailUrl}
              w="100%"
              ratio={3 / 4}
              imageObjectPosition="top"
            />
          ))}
        </div>
      </div>

      {needsLower && (
        <div style={sectionCardStyle}>
          <SectionHead
            title="Lower Garment"
            stepNumber={stepNumberOf('lower')}
            right={
              lowerItems.length > 5 && (
                <button
                  type="button"
                  onClick={() => setLowerModalOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: C.pink,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  View all
                </button>
              )
            }
          />
          {lowerItems.length === 0 ? (
            <span style={{ fontSize: 12, color: C.mid }}>
              No lower garment options available yet.
            </span>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              {lowerItems.slice(0, 5).map((i) => (
                <SelCard
                  key={i.id}
                  selected={lowerCatalogId === i.id}
                  onClick={() => onSelectLower(lowerCatalogId === i.id ? null : i.id)}
                  imageUrl={i.thumbnailUrl}
                  w="100%"
                  ratio={3 / 4}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {needsShoes && (
        <div style={sectionCardStyle}>
          <SectionHead
            title="Footwear"
            stepNumber={stepNumberOf('shoes')}
            right={
              shoeItems.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShoeModalOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: C.pink,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  View all
                </button>
              )
            }
          />
          {shoeItems.length === 0 ? (
            <span style={{ fontSize: 12, color: C.mid }}>No footwear options available yet.</span>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              {shoeItems.slice(0, 5).map((i) => (
                <SelCard
                  key={i.id}
                  selected={shoeCatalogId === i.id}
                  onClick={() => onSelectShoe(shoeCatalogId === i.id ? null : i.id)}
                  imageUrl={i.thumbnailUrl}
                  w="100%"
                  ratio={215.2 / 212.67}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {needsAccessory && accessoryCategories.length > 0 && (
        <AccessoryStep
          categories={accessoryCategories}
          selectedIds={accessoryCatalogIds}
          stepNumber={accessoryStepNumber}
          onToggle={onToggleAccessory}
        />
      )}

      {faceModalOpen && (
        <SelectGridModal
          title="Choose a model face"
          items={faces}
          selectedIds={faceId ? [faceId] : []}
          aspect={215.2 / 212.67}
          hideLabels
          onSelect={(id) => {
            onSelectFace(id);
            setFaceModalOpen(false);
          }}
          onClose={() => setFaceModalOpen(false)}
        />
      )}
      {backgroundModalOpen && (
        <SelectGridModal
          title="Choose a background"
          items={backgrounds}
          selectedIds={backgroundId ? [backgroundId] : []}
          aspect={215.2 / 212.67}
          hideLabels
          onSelect={(id) => {
            onSelectBackground(id);
            setBackgroundModalOpen(false);
          }}
          onClose={() => setBackgroundModalOpen(false)}
        />
      )}
      {poseModalOpen && (
        <SelectGridModal
          title="Choose pose(s)"
          items={poses}
          selectedIds={poseIds}
          multiSelect
          aspect={3 / 4}
          hideLabels
          continueLabel="Use {count} pose(s)"
          onSelect={onTogglePose}
          onClose={() => setPoseModalOpen(false)}
        />
      )}
      {lowerModalOpen && (
        <SelectGridModal
          title="Choose a lower garment"
          items={lowerItems}
          selectedIds={lowerCatalogId ? [lowerCatalogId] : []}
          aspect={3 / 4}
          hideLabels
          onSelect={(id) => {
            onSelectLower(lowerCatalogId === id ? null : id);
            setLowerModalOpen(false);
          }}
          onClose={() => setLowerModalOpen(false)}
        />
      )}
      {shoeModalOpen && (
        <SelectGridModal
          title="Choose footwear"
          items={shoeItems}
          selectedIds={shoeCatalogId ? [shoeCatalogId] : []}
          aspect={215.2 / 212.67}
          hideLabels
          onSelect={(id) => {
            onSelectShoe(shoeCatalogId === id ? null : id);
            setShoeModalOpen(false);
          }}
          onClose={() => setShoeModalOpen(false)}
        />
      )}
    </>
  );
}
