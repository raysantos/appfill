// Shared definitions for AppFill — loaded by the background worker,
// the content script and the settings page. No DOM access here.
(() => {
  const PROFILE_FIELDS = [
    { key: 'firstName', label: 'First name', group: 'Personal' },
    { key: 'lastName', label: 'Last name', group: 'Personal' },
    { key: 'preferredName', label: 'Preferred name', group: 'Personal' },
    { key: 'email', label: 'Email', group: 'Personal', type: 'email' },
    { key: 'phone', label: 'Phone', group: 'Personal', type: 'tel' },

    { key: 'address1', label: 'Street address', group: 'Address' },
    { key: 'address2', label: 'Apt / suite', group: 'Address' },
    { key: 'city', label: 'City', group: 'Address' },
    { key: 'state', label: 'State', group: 'Address', hint: 'e.g. NJ' },
    { key: 'zip', label: 'ZIP', group: 'Address' },
    { key: 'country', label: 'Country', group: 'Address', hint: 'e.g. United States' },

    { key: 'linkedin', label: 'LinkedIn URL', group: 'Links', type: 'url' },
    { key: 'portfolio', label: 'Portfolio / website', group: 'Links', type: 'url' },
    { key: 'github', label: 'GitHub URL', group: 'Links', type: 'url' },

    { key: 'currentTitle', label: 'Current title', group: 'Work' },
    { key: 'currentCompany', label: 'Current company', group: 'Work' },
    { key: 'yearsExperience', label: 'Years of experience', group: 'Work' },
    { key: 'salary', label: 'Salary expectation', group: 'Work' },
    { key: 'startDate', label: 'Availability / start', group: 'Work', hint: 'e.g. 2 weeks notice' },
    { key: 'howHeard', label: 'How did you hear about us', group: 'Work', hint: 'e.g. LinkedIn' },

    { key: 'school', label: 'School', group: 'Education' },
    { key: 'degree', label: 'Degree', group: 'Education' },
    { key: 'major', label: 'Field of study', group: 'Education' },
    { key: 'gradYear', label: 'Graduation year', group: 'Education' },

    { key: 'workAuth', label: 'Authorized to work in the US?', group: 'Standard questions', type: 'yesno' },
    { key: 'sponsorship', label: 'Need visa sponsorship?', group: 'Standard questions', type: 'yesno' },
    { key: 'relocate', label: 'Willing to relocate?', group: 'Standard questions', type: 'yesno' },
    { key: 'over18', label: '18 or older?', group: 'Standard questions', type: 'yesno' },
  ];

  // Checked in order against normalized label text; first hit wins.
  // [key, matches, unless]
  const RULES = [
    ['email', /\be ?mail\b/],
    ['linkedin', /\blinked ?in\b/],
    ['github', /\bgit ?hub\b/],
    ['preferredName', /\b(preferred|nick) ?name\b/],
    ['firstName', /\b(first|given|fore) ?name\b|\bfname\b|^first$/],
    ['lastName', /\b(last|family|sur) ?name\b|\blname\b|^last$/],
    ['fullName', /^(full |your |legal |applicant |candidate )?name$|\bfull name\b|\blegal name\b/],
    ['phone', /\b(phone|mobile|cell|telephone|tel)\b/],
    ['address2', /\baddress (line )?2\b|\b(apt|apartment|suite|unit)\b/],
    ['address1', /\b(street|address( line)?( 1)?)\b/, /\be ?mail\b|\bweb\b|\burl\b|\bip\b/],
    ['zip', /\b(zip|postal|post code|postcode)\b/],
    ['location', /\bcity\b.*\bstate\b|\bcity state\b/],
    ['city', /\b(city|town)\b/],
    ['state', /\b(state|province)\b/, /\bplease state\b|\bunited states\b|\bstatement\b|\bstated\b/],
    ['country', /\bcountry\b/],
    ['location', /\blocation\b|where are you (currently )?(located|based)/],
    ['portfolio', /\b(portfolio|website|web site|personal site|personal url|url)\b/],
    ['currentTitle', /\b(current|job|present|most recent) (job )?(title|role|position)\b|^title$/],
    ['currentCompany', /\b(current|present|most recent) (company|employer)\b|\bcompany name\b|^(company|employer|organization)$/],
    ['yearsExperience', /\byears? (of )?(relevant |professional |total |design )?experience\b|\bhow many years\b/],
    ['salary', /\b(salary|compensation|desired pay|pay expectations?|expected pay|rate expectations?)\b/],
    ['startDate', /\b(start date|available to start|earliest start|when can you start|notice period|availability date)\b/],
    ['workAuth', /\b(authori[sz]ed|eligible|legally (able|permitted)) to work\b|\bwork authori[sz]ation\b|\bright to work\b/],
    ['sponsorship', /\bsponsor/],
    ['relocate', /\brelocat/],
    ['over18', /\b(18|eighteen) years\b|\b18 or older\b|\bat least 18\b|\bover (the age of )?18\b/],
    ['howHeard', /\bhow did you (hear|find|learn)\b|\bhear about\b|\breferral source\b/],
    ['school', /\b(school|university|college|institution)\b/],
    ['degree', /\bdegree\b/],
    ['major', /\b(major|field of study|discipline|area of study)\b/],
    ['gradYear', /\bgraduat(ion|ed)\b/],
  ];

  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'family-name': 'lastName', 'name': 'fullName',
    'nickname': 'preferredName', 'email': 'email', 'tel': 'phone', 'tel-national': 'phone',
    'street-address': 'address1', 'address-line1': 'address1', 'address-line2': 'address2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'zip',
    'country': 'country', 'country-name': 'country', 'organization': 'currentCompany',
    'organization-title': 'currentTitle', 'url': 'portfolio',
  };

  const STATES = {
    al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado',
    ct: 'connecticut', de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia',
    hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas',
    ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts',
    mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
    ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico',
    ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
    or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
    sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
    va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
    pr: 'puerto rico',
  };

  const COUNTRY_ALIASES = [
    ['united states', 'united states of america', 'us', 'usa', 'u s', 'u s a', 'america'],
    ['united kingdom', 'uk', 'great britain', 'gb', 'england'],
    ['canada', 'ca'],
    ['philippines', 'ph', 'the philippines'],
  ];

  // "Job_Application[firstName] *" -> "job application first name"
  function norm(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/\(required\)|\(optional\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // All the ways a stored value might appear in a dropdown.
  function aliases(value) {
    const v = norm(value);
    const out = new Set([v]);
    if (STATES[v]) out.add(STATES[v]);
    for (const [abbr, full] of Object.entries(STATES)) if (full === v) out.add(abbr);
    for (const group of COUNTRY_ALIASES) if (group.includes(v)) group.forEach(a => out.add(a));
    return [...out].filter(Boolean);
  }

  function valueFor(key, p = {}) {
    if (key === 'fullName') return [p.firstName, p.lastName].filter(Boolean).join(' ');
    if (key === 'preferredName') return p.preferredName || p.firstName || '';
    if (key === 'location') return [p.city, p.state].filter(Boolean).join(', ');
    return p[key] || '';
  }

  globalThis.AF = { PROFILE_FIELDS, RULES, AUTOCOMPLETE, STATES, norm, aliases, valueFor };
})();
