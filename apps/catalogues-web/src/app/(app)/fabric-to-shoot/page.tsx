'use client';

import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { BREAKPOINTS } from '@/lib/breakpoints';
import { FabricToShootPreviewPanel } from './fabric-to-shoot-preview-panel';
import { CARD_STYLE, FabricToShootSection, StepBadge } from './fabric-to-shoot-section';
import { FabricToShootStudioFlow } from './fabric-to-shoot-studio-flow';
import { FabricToShootSubmitFooter } from './fabric-to-shoot-submit-footer';
import { useFabricToShoot } from './use-fabric-to-shoot';

export default function FabricToShootPage() {
  const f = useFabricToShoot();

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        title="Fabric to Shoot"
        subtitle="Turn a flat fabric photo into a ready-to-wear garment mockup"
      />

      {/* Same two-column shape as studio/page.tsx's `.studio-layout-wrapper`:
          the left column (wizard steps) scrolls on its own inner div while
          the right column (generation/preview panel) is capped to the
          wrapper's height and scrolls independently, so the panel stays in
          view while the steps scroll past it.

          The classes below this point (.studio-5col-grid, .gender-card-grid,
          .garment-card, .visual-card-wrapper, .gender-card-hover,
          .sel-card-label-box, .studio-select-modal-grid, .studio-audience-section
          + its container query) are byte-for-byte copies of the rules
          studio/page.tsx defines in its own <style> tag. Studio's exported
          SelCard/GenderCard (shared-cards.tsx) and SelectGridModal
          (select-modal.tsx) hardcode these exact class names via `className`,
          but only studio/page.tsx's own <style> tag defines them — any other
          page that reuses those components (this one, embed-studio-wizard.tsx)
          needs its own copy of the same rules or the cards render at the wrong
          size. Keep this block in sync with studio/page.tsx's <style> tag if
          either changes — never the reverse (studio/page.tsx is never edited
          for this page's sake). */}
      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static layout css, mirrors studio/page.tsx's own pattern
        dangerouslySetInnerHTML={{
          __html: `
        .studio-section-card {
          transition: box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out;
        }
        .studio-section-card:hover {
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.05) !important;
          border-color: #BD258733 !important;
        }
        .visual-card-wrapper {
          transition: box-shadow 0.2s ease-in-out, transform 0.2s ease-in-out;
        }
        .visual-card-wrapper:hover {
          background: linear-gradient(${C.card}, ${C.card}) padding-box,
                      linear-gradient(135deg, #BD2587 0%, #ff5b94 100%) border-box !important;
          box-shadow: 0 4px 12px rgba(189, 37, 135, 0.15) !important;
        }
        .garment-card {
          transition: box-shadow 0.2s ease-in-out, transform 0.2s ease-in-out;
        }
        .garment-card:hover {
          background: linear-gradient(${C.card}, ${C.card}) padding-box,
                      linear-gradient(135deg, #BD2587 0%, #ff5b94 100%) border-box !important;
          box-shadow: 0 4px 12px rgba(189, 37, 135, 0.15) !important;
        }
        .gender-card-hover {
          transition: box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out;
        }
        .gender-card-hover:hover {
          border-color: #BD2587 !important;
          box-shadow: 0 4px 12px rgba(189, 37, 135, 0.1) !important;
        }
        .studio-audience-section {
          container: studio-audience / inline-size;
        }
        .gender-card-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        @container studio-audience (max-width: 600px) {
          .gender-card-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @container studio-audience (max-width: 340px) {
          .gender-card-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .studio-5col-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 16px;
        }
        .sel-card-label-box {
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          font-size: 12px;
          line-height: 1.25 !important;
          height: 36px !important;
          max-height: 36px !important;
          box-sizing: border-box !important;
          width: 100% !important;
          text-align: center !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        .f2s-layout-wrapper {
          flex: 1;
          min-height: 0;
          display: flex;
          gap: 20px;
          padding: 20px 20px 24px;
          box-sizing: border-box;
          overflow-y: auto;
        }
        .f2s-left-column {
          flex: 1 1 0;
          min-width: 0;
          max-width: 880px;
          display: flex;
          flex-direction: column;
        }
        .f2s-right-column {
          flex: 1 1 0;
          min-width: 0;
          max-width: 880px;
          overflow-y: auto;
          max-height: 100%;
          padding-right: 4px;
        }
        .f2s-generate-card {
          background: ${C.card};
          border: 1.5px solid ${C.border};
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex-shrink: 0;
          margin-top: 16px;
        }
        @media (max-width: 1279px) {
          .f2s-layout-wrapper {
            flex-direction: column;
            padding: 16px;
            gap: 20px;
          }
          .f2s-left-column {
            max-width: 100%;
            width: 100%;
          }
          .f2s-right-column {
            max-width: 100%;
            width: 100%;
            max-height: none;
            overflow-y: visible;
            margin-top: 8px;
            padding-top: 20px;
            border-top: 1.5px dashed ${C.border};
          }
          .studio-5col-grid {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 10px;
          }
          .garment-card, .visual-card-wrapper {
            max-width: 100%;
            margin: 0 auto;
            width: 100%;
          }
          .gender-card-hover {
            height: 56px !important;
          }
          .gender-card-content {
            gap: 8px !important;
            padding: 0 10px !important;
          }
          .gender-card-content > div:first-child {
            width: 36px !important;
            height: 36px !important;
          }
          .gender-card-content span, .gender-card-label {
            font-size: 13.5px !important;
            font-weight: 600 !important;
          }
        }
        @media (max-width: ${BREAKPOINTS.md}px) {
          .f2s-layout-wrapper {
            padding: 12px;
            gap: 16px;
          }
          .f2s-generate-card {
            margin-top: 16px;
            margin-bottom: 16px;
            padding: 14px 16px;
          }
          .studio-5col-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
          }
          .garment-card, .visual-card-wrapper {
            max-width: 100%;
          }
          .sel-card-label-box {
            -webkit-line-clamp: 3 !important;
            font-size: 11.5px !important;
            height: 46px !important;
            max-height: 46px !important;
            line-height: 1.25 !important;
          }
          .studio-select-modal-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            gap: 10px !important;
          }
        }
        @media (max-width: ${BREAKPOINTS.xs}px) {
          .f2s-layout-wrapper {
            padding: 10px;
            gap: 12px;
          }
          .f2s-generate-card {
            padding: 12px 14px;
            border-radius: 14px;
          }
          .studio-5col-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
          }
          .studio-select-modal-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }
          .garment-card, .visual-card-wrapper {
            max-width: 100%;
          }
          .sel-card-label-box {
            -webkit-line-clamp: 3 !important;
            font-size: 11px !important;
            height: 44px !important;
            max-height: 44px !important;
            line-height: 1.25 !important;
          }
          .gender-card-hover {
            height: 52px !important;
          }
          .gender-card-content {
            gap: 6px !important;
            padding: 0 8px !important;
          }
        }
      `,
        }}
      />

      <div className="f2s-layout-wrapper" style={{ background: C.bg }}>
        <div className="f2s-left-column">
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            <FabricToShootSection
              previewUrl={f.previewUrl}
              uploading={f.uploading}
              uploadProgress={f.uploadProgress}
              uploadError={f.uploadError}
              onFile={f.handleUpload}
              onRemove={f.removeFile}
              gender={f.gender}
              onSelectGender={f.setGender}
              availableGenders={f.availableGenders}
              genderPresets={f.genderPresets}
              presetsLoading={f.presetsLoading}
              presetsError={!!f.presetsError}
              onRetryPresets={f.refetchPresets}
              presetId={f.presetId}
              onSelectPreset={f.setPresetId}
            />
            {f.showStudioFlow ? (
              <FabricToShootStudioFlow
                faces={f.faces}
                faceId={f.faceId}
                onSelectFace={f.setFaceId}
                backgrounds={f.backgrounds}
                backgroundId={f.backgroundId}
                onSelectBackground={f.setBackgroundId}
                poses={f.poses}
                poseIds={f.poseIds}
                onTogglePose={f.togglePose}
                needsLower={f.needsLower}
                needsShoes={f.needsShoes}
                needsAccessory={f.needsAccessory}
                lowerItems={f.lowerItems}
                lowerCatalogId={f.lowerCatalogId}
                onSelectLower={f.setLowerCatalogId}
                shoeItems={f.shoeItems}
                shoeCatalogId={f.shoeCatalogId}
                onSelectShoe={f.setShoeCatalogId}
                accessoryCategories={f.accessoryCategories}
                accessoryCatalogIds={f.accessoryCatalogIds}
                onToggleAccessory={f.toggleAccessory}
              />
            ) : (
              f.presetId && (
                // Preset isn't linked to a Studio garment type yet — the
                // pipeline is just the one fabric->garment job, same as before
                // this flow existed.
                <div style={CARD_STYLE}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <StepBadge n={4} />
                    <div>
                      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
                        Generate
                      </h2>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: C.mid }}>
                        This garment type isn't linked to a model/background/pose flow yet —
                        generating will stop at the garment image.
                      </p>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Pinned footer — sibling of the scrollable div above, not inside
              it, so it stays visible (same "pinned, left column only" effect
              as Studio's own `.studio-generate-card`) while the steps scroll
              past it. */}
          <div className="f2s-generate-card">
            <FabricToShootSubmitFooter
              label={
                f.showStudioFlow
                  ? `Generate image${f.poseIds.length > 1 ? 's' : ''}`
                  : 'Generate Garment'
              }
              creditsCost={f.creditsCost}
              balance={f.balance}
              isUnlimitedPlan={f.isUnlimitedPlan}
              canSubmit={f.canSubmit}
              submitting={f.pipelineRunning}
              submitError={f.pipelineError}
              blockReason={f.blockReason}
              onSubmit={f.submit}
            />
          </div>
        </div>

        <div className="f2s-right-column">
          <FabricToShootPreviewPanel
            garmentPreviewUrl={f.previewUrl}
            jobStatus={f.jobStatus}
            resultUrl={f.resultUrl}
            pipelineRunning={f.pipelineRunning}
            pipelineStage={f.pipelineStage}
            hasGarmentType={f.hasGarmentType}
            pipelineError={f.pipelineError}
            onGenerateAnother={f.generateAnother}
            activeGeneration={f.activeGeneration}
          />
        </div>
      </div>
    </div>
  );
}
