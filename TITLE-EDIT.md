# 타이틀 이미지 작업

- 입력: 사용자 `title.gif` (355×261, 3프레임 선화) 및 기존 고인돌 색상 참고 이미지.
- 도구: 내장 ImageGen 이미지 편집. Python으로 채색하거나 배경을 수정하지 않았습니다.
- 결과: `public/title.png`, RGBA 1728×910. 투명 알파 채널 0~255 확인.
- 원본 GIF: `public/assets/title-original.gif`에 보존.
- 웹 적용: `src/Title.jsx`. 채색 결과는 정적 투명 PNG이며, 웹에서 3단계 CSS로 아주 작게 흔들립니다. 원본 GIF의 각 선화 프레임을 그대로 채색한 애니메이션 GIF는 아닙니다. 모션 감소 설정에서는 흔들림을 멈춥니다.

사용한 최종 편집 프롬프트:

> Edit target Image 1 is the user's hand-drawn game title lettering. Image 2 is ONLY a palette and hand-drawn line-style reference (a dolmen from the game); DO NOT include the dolmen object in the output. Remove the white paper background, color in the existing lettering, and deliver the title alone on true transparent RGBA. Text EXACTLY as drawn: top row 'How to Kill a', lower row 'DOLMEN'. Preserve irregular hand-lettered contours, placement, sizes, wobbly rough outline charm, and two-line composition. It should look like someone carefully bucket-filled the original sketch, NOT a new logo or a typeset font. Preserve letter shapes and uneven lowercase lettering. Recolor the black ink to dark warm brown matching Image 2 without smoothing away roughness. Fill the top row pale bone/cream and DOLMEN a flat muted warm stone-tan matching the rocks. Keep letter counters/holes transparent. No added drawings, cracks, icons, scenery, shadow, glow, frame, gradients, extra text or watermark. Crop unnecessary blank margin, retain every letter with breathing room. Landscape ratio about 1.9:1, genuinely transparent background.
