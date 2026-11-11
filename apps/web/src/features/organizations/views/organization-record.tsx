import type { ReactNode } from 'react';
import { Container } from '@/components/container';
import { Reveal } from '@/components/reveal';
import { SectionError } from '@/components/section-error';
import type { OrgPostSectionsState } from '@/features/posts/presenters/use-org-post-sections';
import { HighlightCarousel } from '@/features/posts/views/highlight-carousel';
import { fillInChecklist, presentSections } from '../presenters/org-page-layout';
import type { ConstitutionModel } from '../presenters/use-constitution';
import type { OrgShowcaseState } from '../presenters/use-org-showcase';
import type { OrganizationPageModel } from '../presenters/use-organization-page';
import {
  AboutSection,
  ContactSection,
  DocumentsSection,
  FillInChecklist,
  ManagePostsLink,
  OfficersSection,
  ProjectsSection,
  UpdatesSection,
} from './org-page-sections';
import { SectionNav } from './section-nav';

export interface OrganizationRecordProps {
  page: OrganizationPageModel;
  constitution: ConstitutionModel;
  /** Highlights and updates; the profile editor's preview has none. */
  posts?: OrgPostSectionsState;
  /** Rank, completed projects and public documents; the preview has none. */
  showcase?: OrgShowcaseState;
  /** Scroll reveals on the live page; off in the editor's preview, which is never scrolled into. */
  animate?: boolean;
}

/**
 * Below the header on /orgs/:slug, the fixed template (docs/DOMAIN_RULES.md, "Organization
 * page"): the highlights band across the page, then "On this page" in a left rail (a sticky
 * chip bar below lg) beside About, Updates, Projects, Officers, Documents and Contact. A
 * section with nothing to show is left out; About and Documents always show, since saying
 * what is missing there is useful. The own account also sees what is left to fill in.
 */
export function OrganizationRecord({
  page,
  constitution,
  posts,
  showcase,
  animate = true,
}: OrganizationRecordProps) {
  const Block = animate ? Reveal : Plain;
  const parts = { page, constitution, posts, showcase };
  const sections = presentSections(parts);
  const checklist = fillInChecklist(parts);
  const postSections = posts?.status === 'ready' ? posts.sections : null;

  return (
    <>
      {postSections && postSections.highlights.length > 0 ? (
        <HighlightCarousel
          highlights={postSections.highlights}
          org={{
            acronym: page.acronym,
            name: page.name,
            logoSrc: page.logoSrc,
            logoSrcSet: page.logoSrcSet,
          }}
          seeAllHref={postSections.highlightsHref}
        />
      ) : null}

      <div className="pt-section">
        <SectionNav sections={sections} />
        <Container className="pt-10 pb-section lg:pt-0">
          <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12 xl:gap-20">
            <div className="max-lg:hidden">
              <SectionNav sections={sections} rail />
            </div>
            <div className="flex max-w-[52rem] min-w-0 flex-col gap-section">
              <Block>
                <AboutSection page={page} />
              </Block>
              {checklist ? (
                <Block>
                  <FillInChecklist items={checklist} />
                </Block>
              ) : null}
              {posts?.status === 'error' ? (
                <SectionError
                  message="Highlights and updates could not be loaded. Check your connection and try again."
                  onRetry={posts.retry}
                />
              ) : null}
              {postSections && postSections.updates.length > 0 ? (
                <Block>
                  <UpdatesSection
                    acronym={page.acronym}
                    updates={postSections.updates}
                    total={postSections.updatesTotal}
                    href={postSections.updatesHref}
                    isOwner={postSections.isOwner}
                  />
                </Block>
              ) : postSections?.isOwner ? (
                <ManagePostsLink acronym={page.acronym} />
              ) : null}
              {showcase && sections.includes('projects') ? (
                <Block>
                  <ProjectsSection acronym={page.acronym} state={showcase} />
                </Block>
              ) : null}
              {page.officers.length > 0 ? (
                <Block>
                  <OfficersSection officers={page.officers} />
                </Block>
              ) : null}
              <Block>
                <DocumentsSection page={page} constitution={constitution} showcase={showcase} />
              </Block>
              {sections.includes('contact') ? (
                <Block>
                  <ContactSection page={page} />
                </Block>
              ) : null}
            </div>
          </div>
        </Container>
      </div>
    </>
  );
}

function Plain({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
