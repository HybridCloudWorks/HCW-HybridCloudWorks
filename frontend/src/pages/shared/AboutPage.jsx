/* eslint-disable complexity */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { loadPublicDataSnapshot } from '@/lib/publicData';
import { fetchPublicSnapshotItems } from '@/lib/publicApi';
import CustomSessionizeWidget from '@/components/widgets/CustomSessionizeWidget';

function normalizeCertification(rawData) {
  // Use the raw data directly for maximum precision with Firestore field names
  const raw = rawData;

  const get = (obj, candidates) => {
    for (const k of candidates) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return undefined;
  };

  const toDate = (v) => {
    if (!v) return undefined;
    if (typeof v?.toDate === 'function') return v.toDate();
    if (typeof v === 'string' || typeof v === 'number') return new Date(v);
    return undefined;
  };

  const toBool = (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    if (typeof v === 'number') return v !== 0;
    return undefined;
  };

  // 5. Image Resolution Strategy
  const resolveImageUrl = () => {
    // Helper to clean/validate URLs
    const cleanUrl = (val) => {
      if (!val || typeof val !== 'string') return undefined;
      let key = val.trim();
      if (key === '') return undefined;
      // Convert GCS URL format to Firebase Storage REST format so storage rules apply
      const gcsMatch = key.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
      if (gcsMatch) {
        key = `https://firebasestorage.googleapis.com/v0/b/${gcsMatch[1]}/o/${encodeURIComponent(gcsMatch[2])}?alt=media`;
      }
      return !key.startsWith('http') && !key.startsWith('/') && !key.startsWith('data:')
        ? `/${key}`
        : key;
    };

    // A. Priority: Complex Object/Array from Firestore (Rowy image upload fields)
    // Checks all known field names for badge/credential images
    let complexData = get(raw, [
      'image',
      'Image',
      'badge',
      'Badge',
      'credentialImage',
      'CredentialImage', // DB schema field name
    ]);

    // Unwrap Array if necessary
    if (Array.isArray(complexData)) {
      complexData = complexData.length > 0 ? complexData[0] : undefined;
    }

    // Attempt to extract URL from Object
    if (complexData && typeof complexData === 'object') {
      const urlCandidate =
        complexData.downloadURL ||
        complexData.downloadUrl ||
        complexData.url ||
        complexData.src ||
        complexData.link;

      const cleaned = cleanUrl(urlCandidate);
      if (cleaned) return cleaned;
    }

    // B. Fallback: Simple string URL fields
    const simpleUrl = get(raw, [
      'imageUrl',
      'ImageUrl',
      'image_url',
      'credentialImage',
      'CredentialImage', // also check as plain string
    ]);
    return cleanUrl(simpleUrl);
  };

  const normalized = {
    id: raw.id,
    name: get(raw, ['name', 'Name']),
    issuer: (() => {
      const iv = get(raw, ['issuer', 'Issuer']);
      if (Array.isArray(iv)) return iv[0] ?? 'Other';
      if (!iv) return 'Other';
      if (iv === 'Microsft') return 'Microsoft';
      if (typeof iv === 'string') {
        const s = iv.trim();
        const low = s.toLowerCase();
        if (low === 'google cloud partners' || low === 'google cloud partner')
          return 'Google Cloud Partners';
        if (low === 'google cloud') return 'Google Cloud';
      }
      return iv;
    })(),
    issue_date: toDate(get(raw, ['issueDate', 'issue_date', 'IssueDate'])),
    exp_date: toDate(get(raw, ['expDate', 'exp_date', 'ExpDate'])),
    certState: toBool(get(raw, ['certState', 'isValid', 'is_valid', 'cert_state'])),
    code: get(raw, ['code', 'Code']),
    verify_url: get(raw, ['verifyUrl', 'verify_url', 'VerifyUrl']),
    image_url: resolveImageUrl(),
    display_order: get(raw, ['displayOrder', 'display_order', 'DisplayOrder']) ?? 999,
    tags: get(raw, ['tags', 'Tags']) || [],
    display: get(raw, ['display', 'Display']) === true,
  };
  return normalized;
}

const CertificationCard = ({ cert, onImageClick }) => {
  const isRetired =
    (Object.prototype.hasOwnProperty.call(cert, 'certState') && cert.certState === false) ||
    (Object.prototype.hasOwnProperty.call(cert, 'is_valid') && cert.is_valid === false) ||
    (Object.prototype.hasOwnProperty.call(cert, 'isValid') && cert.isValid === false) ||
    (Object.prototype.hasOwnProperty.call(cert, 'cert_state') && cert.cert_state === false);

  const expDate = cert.exp_date ? new Date(cert.exp_date) : null;
  const issueDate = cert.issue_date ? new Date(cert.issue_date) : null;
  const now = new Date();
  const isExpired = expDate && expDate < now;

  const formatDate = (date) =>
    date
      ? date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : 'N/A';

  let dateLabel = 'Valid since';
  let dateValue = formatDate(issueDate);

  if (expDate) {
    dateLabel = isExpired ? 'Expired on' : 'Valid until';
    dateValue = formatDate(expDate);
  }

  let statusClass = '';
  if (isRetired) statusClass = 'cert-retired';
  else if (isExpired) statusClass = 'cert-expired';

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.02 }}
      className={`certification-technical-card p-4 rounded-2xl flex flex-col group relative overflow-hidden h-full ${statusClass}`}
    >
      {(isRetired || isExpired) && (
        <div className="cert-watermark text-slate-500 dark:text-slate-400">
          {isRetired ? 'Retired' : 'Expired'}
        </div>
      )}

      {!isRetired && !isExpired && (
        <div className="absolute -right-4 -top-4 opacity-[0.03] dark:opacity-[0.05] group-hover:opacity-[0.08] transition-opacity pointer-events-none">
          <span className="material-symbols-outlined text-[100px] rotate-12">verified</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-4 relative z-10">
        {cert.image_url ? (
          <div className="relative">
            <div className="absolute inset-0 bg-white/20 dark:bg-white/5 blur-md rounded-full"></div>
            <button
              type="button"
              onClick={() => onImageClick(cert.image_url)}
              className="cert-badge-container relative shrink-0 w-20 h-20 flex items-center justify-center p-2 rounded-xl border border-white/40 dark:border-white/10 hover:scale-110 transition-transform cursor-pointer overflow-hidden"
              aria-label={`View badge for ${cert.name}`}
            >
              <img
                src={cert.image_url}
                alt={`${cert.issuer} badge`}
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-contain drop-shadow-sm ${isRetired || isExpired ? 'grayscale opacity-60' : ''}`}
                onError={(e) => {
                  console.error('Image load failed for:', cert.name, cert.image_url);
                  e.target.style.opacity = '0.5';
                  e.target.setAttribute('alt', 'Image Failed');
                }}
              />
            </button>
          </div>
        ) : (
          <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700">
            <span className="material-symbols-outlined text-slate-400">image_not_supported</span>
          </div>
        )}
        <div className="flex flex-col items-end gap-1.5" />
      </div>

      <div className="space-y-2 relative z-10 grow">
        <h4 className="text-slate-900 dark:text-white font-bold text-xs tracking-tight leading-snug group-hover:text-accent-blue transition-colors line-clamp-2 min-h-[2.5em]">
          {cert.name}
        </h4>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
          <span className="material-symbols-outlined text-[12px]">calendar_today</span>
          <span className="font-mono">
            {dateLabel}: {dateValue}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-2.5 flex items-center justify-between border-t border-slate-300/70 dark:border-slate-700/50 relative z-10">
        {cert.verify_url ? (
          <a
            href={cert.verify_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
            aria-label={`Verify ${cert.name}`}
          >
            <span className="material-symbols-outlined text-[16px]">check_box</span>
          </a>
        ) : (
          <span
            className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-400"
            aria-label={`Verification unavailable for ${cert.name}`}
          >
            <span className="material-symbols-outlined text-[16px]">check_box</span>
          </span>
        )}

        {cert.code && (
          <div className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 px-1.5 py-0.5 rounded">
            {cert.code}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default function AboutPage() {
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCertImage, setSelectedCertImage] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [isCertSectionInView, setIsCertSectionInView] = useState(false);
  const certSectionRef = useRef(null);
  const closeModal = () => {
    setSelectedCertImage(null);
  };

  useEffect(() => {
    const el = certSectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsCertSectionInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isCertSectionInView) return;
    const fetchData = async () => {
      setLoading(true);

      try {
        // Static JSON is the fast public path. The snapshots API is only a
        // quiet fallback for deploys that do not have the generated file yet.
        let rawItems = await loadPublicDataSnapshot('/data/certifications.json');

        if (rawItems.length === 0) {
          rawItems = await fetchPublicSnapshotItems('certifications');
        }

        try {
          rawItems = rawItems.filter((item) => item && typeof item === 'object');
        } catch {
          rawItems = [];
        }

        const certItems = rawItems
          .map((d) => normalizeCertification(d))
          .filter((cert) => cert.display === true)
          .map((cert) => {
            if (cert.issuer === 'Microsoft') {
              const name = cert.name || '';
              const code = cert.code || '';

              const isM365 = /(MS-|AB-)/i.test(name) || /(MS-|AB-)/i.test(code);

              if (isM365) {
                return { ...cert, issuer: 'Microsoft 365' };
              }

              // Microsoft Azure: DP-*, SC-*, PL-*, AZ-*, AI-*
              const isAzure =
                /(DP-|SC-|PL-|AZ-|AI-)/i.test(name) || /(DP-|SC-|PL-|AZ-|AI-)/i.test(code);

              if (isAzure) {
                return { ...cert, issuer: 'Microsoft Azure' };
              }

              // Microsoft Education: MIEE, MCE, MCT
              const isEducation =
                /(MIEE|innovative educator|MCE|certified educator|MCT|certified trainer)/i.test(
                  name
                ) || /(MIEE|MCE|MCT)/i.test(code);

              if (isEducation) {
                return { ...cert, issuer: 'Microsoft Education' };
              }

              // Rest stays as Microsoft: MSCA*, MCP, community badges, etc.
            }
            return cert;
          });

        certItems.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
        setCertifications(certItems);

        const newExpanded = {};
        certItems.reduce((acc, cert) => {
          acc[cert.issuer] = false;
          return acc;
        }, newExpanded);
        setExpandedSections(newExpanded);
      } catch (e) {
        console.error('Error loading certifications:', e);
        setError('Failed to load certifications');
        setCertifications([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isCertSectionInView]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    };

    if (selectedCertImage) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedCertImage]);

  const certificationsByIssuer = useMemo(() => {
    if (!certifications) return {};

    const groupedCerts = certifications.reduce((acc, cert) => {
      const issuer = cert.issuer || 'Other';
      if (!acc[issuer]) {
        acc[issuer] = [];
      }
      acc[issuer].push(cert);
      return acc;
    }, {});

    const AWS_TIER = {
      professional: 0,
      associate: 1,
      specialty: 2,
      speciality: 2,
      practitioner: 3,
    };
    const getAwsTier = (name) => {
      const n = (name || '').toLowerCase();
      for (const [key, rank] of Object.entries(AWS_TIER)) {
        if (n.includes(key)) return rank;
      }
      return 99;
    };
    const isAwsIssuer = (issuer) => /aws|amazon web services/i.test(issuer);

    const getBroadcomTier = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('double')) return 2; // Double VCP last
      if (n.includes('professional')) return 0; // Professional first
      return 1; // Everything else in between
    };
    const isBroadcomIssuer = (issuer) => /broadcom|vmware/i.test(issuer);

    const getFinOpsTier = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('certified')) {
        if (n.includes('professional')) return 0;
        if (n.includes('engineer')) return 1;
        if (n.includes('practitioner')) return 2;
        return 3;
      }
      if (n.includes('focus')) return 4;
      if (n.includes('for ai') || n.includes('ai trained')) return 5;
      if (n.includes('container')) return 6;
      return 99;
    };
    const isFinOpsIssuer = (issuer) => /finops/i.test(issuer);

    const getGoogleCloudTier = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('professional')) return 0;
      if (n.includes('foundational') || n.includes('foundation')) return 1;
      return 99;
    };
    const isGoogleCloudIssuer = (issuer) =>
      /google cloud/i.test(issuer) && !/partner/i.test(issuer);
    const isGooglePartnersIssuer = (issuer) =>
      /google cloud.*partner|google.*partner/i.test(issuer);

    const getMsTier = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('expert')) return 0;
      if (n.includes('associate')) return 1;
      if (n.includes('fundamentals')) return 2;
      return 99;
    };

    const newestFirst = (a, b) => {
      const dateA = a.issue_date ? new Date(a.issue_date).getTime() : 0;
      const dateB = b.issue_date ? new Date(b.issue_date).getTime() : 0;
      return dateB - dateA;
    };

    for (const issuer in groupedCerts) {
      if (isAwsIssuer(issuer)) {
        groupedCerts[issuer].sort((a, b) => {
          const tierDiff = getAwsTier(a.name) - getAwsTier(b.name);
          if (tierDiff !== 0) return tierDiff;
          return newestFirst(a, b);
        });
      } else if (isBroadcomIssuer(issuer)) {
        groupedCerts[issuer].sort((a, b) => {
          const tierDiff = getBroadcomTier(a.name) - getBroadcomTier(b.name);
          if (tierDiff !== 0) return tierDiff;
          return newestFirst(a, b);
        });
      } else if (isGooglePartnersIssuer(issuer)) {
        groupedCerts[issuer].sort(newestFirst);
      } else if (isGoogleCloudIssuer(issuer)) {
        groupedCerts[issuer].sort((a, b) => {
          const tierDiff = getGoogleCloudTier(a.name) - getGoogleCloudTier(b.name);
          if (tierDiff !== 0) return tierDiff;
          return newestFirst(a, b);
        });
      } else if (isFinOpsIssuer(issuer)) {
        const getAiLevel = (name) => {
          const m = (name || '').match(/level\s*(\d+)/i);
          return m ? parseInt(m[1], 10) : 99;
        };
        groupedCerts[issuer].sort((a, b) => {
          const tierA = getFinOpsTier(a.name);
          const tierB = getFinOpsTier(b.name);
          const tierDiff = tierA - tierB;
          if (tierDiff !== 0) return tierDiff;
          // FinOps AI tier: sort by Level number ascending (1 → 2 → 3)
          if (tierA === 5) return getAiLevel(a.name) - getAiLevel(b.name);
          return newestFirst(a, b);
        });
      } else if (issuer === 'Microsoft 365') {
        // AB certs first, then MS certs — within each prefix group: Expert → Associate → Fundamentals, newest first
        const getPrefixRank = (cert) => {
          const n = cert.name || '';
          const c = cert.code || '';
          if (n.includes('AB-') || c.includes('AB-')) return 0;
          return 1;
        };
        groupedCerts[issuer].sort((a, b) => {
          const prefixDiff = getPrefixRank(a) - getPrefixRank(b);
          if (prefixDiff !== 0) return prefixDiff;
          const tierDiff = getMsTier(a.name) - getMsTier(b.name);
          if (tierDiff !== 0) return tierDiff;
          return newestFirst(a, b);
        });
      } else if (issuer === 'Microsoft Azure') {
        const getAzurePrefixRank = (cert) => {
          const n = cert.name || '';
          const c = cert.code || '';
          if (n.includes('AZ-') || c.includes('AZ-')) return 0;
          if (n.includes('AI-') || c.includes('AI-')) return 1;
          if (n.includes('SC-') || c.includes('SC-')) return 2;
          if (n.includes('DP-') || c.includes('DP-')) return 3;
          if (n.includes('PL-') || c.includes('PL-')) return 4;
          return 99;
        };
        groupedCerts[issuer].sort((a, b) => {
          const prefixDiff = getAzurePrefixRank(a) - getAzurePrefixRank(b);
          if (prefixDiff !== 0) return prefixDiff;
          const tierDiff = getMsTier(a.name) - getMsTier(b.name);
          if (tierDiff !== 0) return tierDiff;
          return newestFirst(a, b);
        });
      } else if (issuer === 'Microsoft Education') {
        const getMsEdTier = (name) => {
          const n = (name || '').toLowerCase();
          if (n.includes('miee') || n.includes('innovative educator')) return 0;
          if (n.includes('mce') || n.includes('certified educator')) return 1;
          if (n.includes('mct') || n.includes('certified trainer')) return 2;
          return 99;
        };
        groupedCerts[issuer].sort((a, b) => {
          const tierDiff = getMsEdTier(a.name) - getMsEdTier(b.name);
          if (tierDiff !== 0) return tierDiff;
          return newestFirst(a, b);
        });
      } else if (issuer === 'MMCC Program') {
        groupedCerts[issuer].sort(newestFirst);
      } else if (issuer === 'Microsoft') {
        const getYearFromName = (name) => {
          const m = (name || '').match(/\b(20\d{2}|\d{4})\b/);
          return m ? parseInt(m[1], 10) : 0;
        };
        groupedCerts[issuer].sort((a, b) => {
          const yearDiff = getYearFromName(b.name) - getYearFromName(a.name);
          if (yearDiff !== 0) return yearDiff;
          return newestFirst(a, b);
        });
      } else {
        groupedCerts[issuer].sort((a, b) => {
          if ((a.display_order ?? 999) !== (b.display_order ?? 999)) {
            return (a.display_order ?? 999) - (b.display_order ?? 999);
          }
          return (a.name || '').localeCompare(b.name || '');
        });
      }
    }

    return groupedCerts;
  }, [certifications]);

  const issuerOrder = useMemo(() => {
    return Object.keys(certificationsByIssuer).sort((a, b) => a.localeCompare(b));
  }, [certificationsByIssuer]);

  const openModal = (imageUrl) => {
    setSelectedCertImage(imageUrl);
  };

  const toggleSection = (issuer) => {
    setExpandedSections((prev) => ({
      ...prev,
      [issuer]: !prev[issuer],
    }));
  };

  return (
    <>
      <Helmet>
        <title>About Saul Patino | Hybrid Cloud Works</title>
      </Helmet>

      <main className="relative grow w-full max-w-400 mx-auto px-4 md:px-8 py-10 space-y-16 bg-background text-foreground">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 right-0 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,rgba(172,183,174,0.14),transparent_70%)] blur-2xl"></div>
          <div className="absolute bottom-0 left-10 h-65 w-65 rounded-full bg-[radial-gradient(circle_at_center,rgba(194,180,144,0.12),transparent_70%)] blur-2xl"></div>
        </div>

        {/* HERO SECTION */}
        <section className="relative animate-fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-16 items-start">
            {/* Left: Profile Section - centered within left column */}
            <div className="flex flex-col items-center gap-8">
              <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40">
                <span className="w-1.5 h-1.5 rounded-full bg-muted"></span>
                <span className="text-xs uppercase font-bold tracking-[0.28em] text-(--dark-gray) dark:text-(--light-gray) font-mono">
                  About the Architect
                </span>
              </div>
              <div className="relative group">
                <div className="absolute -inset-1 bg-linear-to-r from-slate-400 to-slate-300 dark:from-slate-600 dark:to-slate-400 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative w-48 h-48 md:w-60 md:h-60 rounded-full overflow-hidden border-2 border-slate-300/70 dark:border-slate-700/50 shadow-glow">
                  <img
                    alt="Professional headshot of Saul Patino"
                    width="1000"
                    height="1000"
                    fetchPriority="high"
                    decoding="async"
                    className="w-full h-full object-cover"
                    src="/icons/hcw/portrait_1000x1000.png"
                  />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-black text-slate-900 dark:text-white tracking-tight font-display">
                  <span className="text-muted-foreground">Saul Patino</span>
                </h1>
                <p className="text-slate-700 dark:text-muted-foreground font-medium text-lg">
                  MultiCloud Architect
                </p>
              </div>
            </div>

            {/* Right: Experience Section */}
            <div className="glass-panel p-6 md:p-8 rounded-2xl space-y-4 lg:col-span-2">
              <div className="text-slate-700 dark:text-slate-300 leading-relaxed space-y-4">
                <p>
                  With many years of experience spanning key areas of cloud computing, I have built
                  a deep understanding of what drives successful digital transformation. My career
                  has been dedicated to mastering the complexities of infrastructure, security, and
                  scalability, allowing me to deliver solutions that are not just effective, but
                  foundational to business growth.
                </p>
                <p>
                  In recent years, I have focused on strengthening my position as a{' '}
                  <strong>Well-Architected Architect</strong>. By dialing in on the core pillars of
                  cloud architecture, I strive to go beyond simply discussing Well-Architected
                  principles—I aim to excel in their implementation. My goal is to dive deeper into
                  these frameworks to ensure every solution is secure, reliable, efficient, and
                  cost-effective.
                </p>
                <p>
                  Beyond technical architecture, I am passionate about using my skills to give back.
                  I actively engage with local communities and the Education field, mentoring the
                  next generation of cloud professionals and sharing knowledge to foster growth and
                  innovation.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SPEAKING ENGAGEMENTS */}
        <section className="space-y-6">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40 mb-4">
              <h3
                className="text-2xl text-slate-900 dark:text-white flex items-center gap-2"
                style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
              >
                <span className="material-symbols-outlined text-(--subtitle-gray)">campaign</span>
                Speaking Engagements
              </h3>
            </div>
          </div>
          <CustomSessionizeWidget speakerId="c6yicoezls" />
        </section>

        {/* CERTIFICATION REGISTRY */}
        <section ref={certSectionRef} className="space-y-6 mt-16">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-secondary/15 border border-secondary/40 mb-4">
              <h3
                className="text-2xl text-slate-900 dark:text-white flex items-center gap-2"
                style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
              >
                <span className="material-symbols-outlined text-accent-blue">verified</span>
                Certification Registry
              </h3>
            </div>
          </div>

          {(() => {
            if (loading) {
              return (
                <div className="flex justify-center items-center py-20">
                  <span className="material-symbols-outlined animate-spin text-[32px] text-slate-400 dark:text-slate-600">
                    hourglass_bottom
                  </span>
                </div>
              );
            }
            if (error) {
              return (
                <div className="text-center p-10 border-2 border-dashed rounded-lg bg-red-50/80 dark:bg-red-950/20 text-red-700 dark:text-red-400">
                  <span className="material-symbols-outlined text-[48px] block mb-4 mx-auto">
                    error_outline
                  </span>
                  <h3 className="text-xl font-semibold">Error Loading Certifications</h3>
                  <p className="mt-2 text-sm">{error}</p>
                </div>
              );
            }
            if (issuerOrder.length === 0) {
              return (
                <div className="text-center p-10 border-2 border-dashed rounded-lg bg-slate-50/80 dark:bg-slate-900/20">
                  <span className="material-symbols-outlined text-[48px] block mb-4 mx-auto text-slate-400">
                    verified
                  </span>
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                    No Certifications Found
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mt-2 text-sm">
                    Certifications data is currently being updated. Please check back soon!
                  </p>
                </div>
              );
            }
            return (
              <div className="space-y-8">
                {issuerOrder.map((issuer) => {
                  const isExpanded = expandedSections[issuer] !== false;
                  const certs = certificationsByIssuer[issuer] || [];

                  return (
                    <div key={issuer}>
                      <button
                        className="w-full flex items-center gap-3 mb-4 pb-3 border-b border-slate-300/70 dark:border-secondary/40 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors p-3 rounded-lg text-left group"
                        onClick={() => toggleSection(issuer)}
                      >
                        <span className="text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-(--popover-foreground) transition-colors">
                          {isExpanded ? (
                            <span className="material-symbols-outlined text-[20px]">
                              expand_less
                            </span>
                          ) : (
                            <span className="material-symbols-outlined text-[20px]">
                              expand_more
                            </span>
                          )}
                        </span>
                        <span className="material-symbols-outlined text-[20px] text-(--subtitle-gray)">
                          card_membership
                        </span>
                        <h3
                          className="text-xl text-slate-900 dark:text-white grow select-none"
                          style={{ fontFamily: 'Mona Sans, Inter, sans-serif' }}
                        >
                          {issuer}
                        </h3>
                        <span className="text-xs bg-slate-200/70 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-full font-mono">
                          {certs.length}
                        </span>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4 py-4">
                              {certs.map((cert) => (
                                <CertificationCard
                                  key={cert.id}
                                  cert={cert}
                                  onImageClick={openModal}
                                />
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      </main>

      {/* CERTIFICATION IMAGE MODAL */}
      {selectedCertImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
          onClick={closeModal}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="relative cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedCertImage}
              alt="Enlarged certification badge"
              className="block w-auto h-auto max-w-[min(640px,90vw)] max-h-[80vh] object-contain rounded-lg shadow-2xl"
              onError={(_e) => {
                console.error('Modal image failed to load:', selectedCertImage);
              }}
            />
            <button
              onClick={closeModal}
              className="absolute -top-4 -right-4 text-white bg-black/70 hover:bg-black/90 rounded-full p-2 transition-colors"
              aria-label="Close modal"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
