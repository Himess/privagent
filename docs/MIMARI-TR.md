# PrivAgent: Proje Mimarisi ve Gizlilik Modeli

*Versiyon 4.4 — Mart 2026*

---

## 1. PrivAgent Nedir?

PrivAgent, **Base L2 zincirine gizlilik katmanı ekleyen bir ödeme protokolüdür.** AI agent'lar (otonom yazılım ajanları) x402 HTTP ödeme protokolü ile API'lara ödeme yapar. Problem: bu ödemelerin hepsi herkese açık, zincir üzerinde görünür.

Bir agent bir API'ya 1 USDC ödediğinde, herkes bunu görebilir:
- Kim ödedi?
- Kime ödedi?
- Ne kadar ödedi?
- Ne zaman, hangi API'ya, kaç kez?

Bu, agent'ların ticari stratejilerini, harcama kalıplarını ve iş ilişkilerini ifşa eder. **PrivAgent bu sorunu çözer.**

### Ne Yapıyor?

USDC'yi bir "korumalı havuz" (ShieldedPoolV4) kontratına kilitler. Bu havuzdaki bakiyeler **şifreli UTXO'lar** olarak tutulur. Her işlem bir **ZK (sıfır bilgi) kanıtı** ile yapılır. Zincir üzerinde sadece kriptografik kanıt görünür — miktar, gönderici ve alıcı gizlidir.

### Neden Yapıyoruz?

| Sebep | Açıklama |
|-------|----------|
| **Strateji sızıntısı** | Rakip agent'lar birbirlerinin API harcamalarını izleyebilir |
| **MEV saldırıları** | Yıllık $1B+ değerinde front-running kayıpları |
| **Rekabet istihbaratı** | Ödeme geçmişinden tüm iş modeli çıkarılabilir |
| **Pazar boşluğu** | Base'de x402+ERC-8004 uyumlu hiçbir gizlilik protokolü yok |

---

## 2. Temel Kavramlar

### UTXO Modeli

Geleneksel banka hesabı yerine **harcanmamış işlem çıktısı (UTXO)** modeli kullanılır. Bitcoin'e benzer ama gizli.

```
Hesap modeli:      Alice bakiyesi = 10 USDC (herkes görür)
UTXO modeli:       UTXO_1 = Poseidon(5, pubkey, r1) → commitment_1
                   UTXO_2 = Poseidon(5, pubkey, r2) → commitment_2
                   (kimse ne kadar olduğunu bilmez, commitment = hash)
```

Her UTXO şu 3 bileşenden oluşur:
- **amount**: Miktar (6 decimal USDC)
- **pubkey**: Alıcının Poseidon public key'i → `Poseidon(privateKey)`
- **blinding**: Rastgele alan elemanı (her UTXO'yu benzersiz yapar)

### Commitment (Taahhüt)

```
commitment = Poseidon(amount, pubkey, blinding)
```

Bu hash zincire yazılır. Kimse sadece hash'ten amount veya pubkey çıkaramaz. Ama sahibi bu 3 değeri bildiği için UTXO'nun kendisine ait olduğunu kanıtlayabilir.

### Nullifier (Geçersizleştirici)

Bir UTXO harcanırken, bunu kanıtlamak için nullifier üretilir:

```
nullifier = Poseidon(commitment, leafIndex, privateKey)
```

- Her UTXO sadece **bir kez** harcanabilir (nullifier zincire yazılır)
- Nullifier'dan commitment'e veya privateKey'e geri dönülemez (tek yönlü hash)
- İki farklı UTXO farklı nullifier üretir → **bağlantısız**

### Merkle Ağacı

Tüm commitment'lar derinlik 20'lik bir Merkle ağacına eklenir (~1 milyon yaprak kapasitesi). Bir UTXO'nun havuzda var olduğunu kanıtlamak için Merkle kanıtı kullanılır — hangi UTXO olduğu ortaya çıkmadan.

---

## 3. V3'ten V4'e Geçiş: Stealth Adresler → ECDH Note Encryption

### V3: Stealth Adresler (Eski Sistem)

V3'te alıcı gizliliği **stealth adresler** ile sağlanıyordu:

```
1. Sunucu 2 keypair yayınlar: spendingPubKey + viewingPubKey
2. Gönderici rastgele ephemeral key üretir
3. ECDH(ephemeralPriv, viewingPub) → sharedSecret
4. stealthPubKey = spendingPub + hash(sharedSecret) × G
5. stealthAddress = keccak256(stealthPubKey)
   → Paraları bu tek kullanımlık adrese gönderir
```

**V3'ün Problemleri:**
- Her ödeme için yeni bir Ethereum adresi gerekiyor
- **Miktarlar zincir üzerinde AÇIK** — withdraw() sinyallerinde görünüyor
- Tek-girdi circuit'i → bir seferde sadece 1 UTXO harcanabiliyor
- StealthRegistry ayrı bir kontrat, ekstra karmaşıklık
- Stealth adresi + UTXO modeli birbirine uymuyordu

### V4: ECDH Note Encryption (Yeni Sistem)

V4'te stealth adresleri tamamen kaldırdık. Yerine:

1. **Poseidon public key** = `Poseidon(privateKey)` → cüzdan kimliği
2. **secp256k1 ECDH** → şifreleme anahtarı türetme
3. **AES-256-GCM** → UTXO verilerini şifreleme
4. **JoinSplit circuit** → çoklu giriş/çıkış, miktarlar tamamen gizli

```
V3:  Stealth adres → Ethereum adresi hesaplama → miktarlar açık
V4:  ECDH key exchange → AES şifreleme → miktarlar GİZLİ
```

### Neden Değiştirdik?

| Konu | V3 (Stealth) | V4 (ECDH Note Encryption) |
|------|-------------|---------------------------|
| **Miktar gizliliği** | Zincirde AÇIK | Tamamen GİZLİ (publicAmount=0) |
| **Alıcı gizliliği** | Tek kullanımlık adres | Poseidon pubkey (hash içinde) |
| **UTXO modeli** | Tek girdi | JoinSplit (1x2, 2x2) — çoklu girdi/çıktı |
| **Anahtar yönetimi** | 2 keypair (spending+viewing) | 1 Poseidon key + 1 ECDH key |
| **Karmaşıklık** | Stealth Registry + ephemeral key | Tek encryptNote/decryptNote fonksiyonu |
| **View tag** | İlk byte (deterministik) | Poseidon(priv, pub, nonce) — rastgele |
| **Uyumluluk** | StealthRegistry ayrı kontrat | Tek ShieldedPoolV4 kontratı |

**Kısaca:** Stealth adresleri "alıcı kim?" sorusunu çözüyordu ama "ne kadar?" sorusunu çözmüyordu. V4'te her iki soruyu da çözüyoruz.

---

## 4. Gizlilik Nasıl Sağlanıyor?

### 4.1. ECDH Key Exchange (Diffie-Hellman Anahtar Değişimi)

İki taraf (alıcı ve gönderici) hiç ortak anahtar paylaşmadan aynı gizli anahtarı üretir:

```
Alıcı (Buyer):    ecdhPrivKey_A, ecdhPubKey_A
Sunucu (Server):  ecdhPrivKey_B, ecdhPubKey_B

sharedSecret = ECDH(privKey_A, pubKey_B)
             = ECDH(privKey_B, pubKey_A)   ← Aynı sonuç!

encryptionKey = HKDF-SHA256(sharedSecret, salt, info, 32 byte)
```

Bu key ile UTXO verileri AES-256-GCM ile şifrelenir.

### 4.2. Note Encryption (Not Şifreleme)

Bir ödeme yapılırken UTXO verileri şifrelenir:

```
Düz metin (72 byte):
  ├── amount   (8 byte, big-endian)    → 1,000,000 (1 USDC)
  ├── pubkey   (32 byte, big-endian)   → Poseidon(serverPrivKey)
  └── blinding (32 byte, big-endian)   → Rastgele alan elemanı

Şifreli çıktı (100 byte):
  ├── IV       (12 byte)              → Rastgele başlangıç vektörü
  ├── AuthTag  (16 byte)              → Bütünlük kanıtı (tamper detection)
  └── Ciphertext (72 byte)            → AES-256-GCM şifreli veri
```

**Sadece doğru ECDH private key'e sahip olan taraf şifreyi çözebilir:**
- Ödeme notu (enc1) → Sunucunun ECDH key'i ile şifrelenir → sadece sunucu çözebilir
- Para üstü notu (enc2) → Alıcının kendi ECDH key'i ile şifrelenir → sadece alıcı çözebilir

### 4.3. JoinSplit ZK Circuit (Sıfır Bilgi Kanıtı)

Her işlem bir Groth16 ZK kanıtı üretir. Bu kanıt şunları kanıtlar **ama ortaya çıkarmaz:**

```
Circuit şunu kanıtlar:
  1. "Bu UTXO'ların sahibiyim" (privateKey'i biliyorum)
  2. "Bu UTXO'lar Merkle ağacında var" (membership proof)
  3. "Girdiler + publicAmount = Çıktılar + protocolFee" (denge korunuyor)
  4. "Nullifier'lar doğru hesaplanmış" (çift harcama yok)
  5. "Miktarlar 0 ile 2^120 arasında" (taşma yok)

Circuit şunları GİZLER:
  ✗ Miktarlar (amount)
  ✗ Alıcı kimliği (pubkey)
  ✗ Gönderici kimliği (privateKey)
  ✗ Hangi UTXO harcanıyor (blinding)
  ✗ Girdi/çıktı bağlantısı (nullifier unlinkable)
```

### 4.4. Zincir Üzerinde Ne Görünür?

Bir private transfer yapıldığında zincirdeki veriler:

```solidity
transact() çağrısı:
  pA, pB, pC       → ZK kanıtı (anlamsız sayılar)
  root              → Merkle kökü (hangi ağaç durumu)
  publicAmount = 0  → "Hiç para giriş/çıkış yok" (GİZLİ transfer)
  extDataHash       → Rastgele görünen hash
  protocolFee       → Protokol ücreti (minimum $0.01)
  inputNullifiers   → Harcanan UTXO'ların nullifier'ları (bağlantısız)
  outputCommitments → Yeni UTXO commitment'ları (bağlantısız)
  viewTags          → 1 byte per çıktı (tarama optimizasyonu)
```

**Bir blockchain gözlemcisi:**
- "Birisi bir JoinSplit işlemi yaptı" → Doğru
- "Kim yaptı?" → **Bilinmiyor** (nullifier bağlantısız)
- "Kime gönderdi?" → **Bilinmiyor** (commitment gizli)
- "Ne kadar?" → **Bilinmiyor** (publicAmount=0, miktar şifreli)
- "Bu işlem şu önceki işlemle ilgili mi?" → **Bilinmiyor** (UTXO modeli bağlantıyı kırar)

### 4.5. View Tags (Tarama Optimizasyonu)

Alıcı, havuzdaki tüm UTXO'ları tarayarak kendisine ait olanları bulur. Ama 1 milyon UTXO varsa her birini ECDH + AES ile decrypt etmek çok yavaştır.

Çözüm: **View Tag** — her UTXO'ya 1 byte etiket eklenir:

```
viewTag = Poseidon(senderPrivKey, recipientPubKey, nonce) mod 256
```

Tarama:
1. Her UTXO'nun view tag'ını kontrol et (1 byte karşılaştırma)
2. Sadece eşleşenleri decrypt et (~1/256 oranı)
3. ~256x hızlanma

V4.4'te nonce eklendi — aynı sender→recipient çifti her seferinde farklı tag üretir, böylece "bu 2 UTXO aynı kişiye gitti" bilgisi sızamaz.

---

## 5. x402 Ödeme Akışı

### Tam Akış (Agent → API)

```
                                    ZİNCİR ÜZERİ
                                    ─────────────
1. Agent: GET /api/weather
   ← Sunucu: HTTP 402 + {price: "1000000", payToPubkey: "...",
                          serverEcdhPubKey: "...", scheme: "zk-exact-v2"}

2. Agent:
   a) Coin selection → uygun UTXO'ları seç
   b) paymentUTXO = createUTXO(1_000_000, serverPoseidonPubkey)
   c) changeUTXO = createUTXO(kalan, myPoseidonPubkey)
   d) enc1 = encryptNote(paymentUTXO, myEcdhPriv, serverEcdhPub)
   e) enc2 = encryptNote(changeUTXO, myEcdhPriv, myEcdhPub)
   f) JoinSplit ZK kanıtı üret (Groth16, ~10-30 saniye)
   g) Payment header = base64(JSON{proof, nullifiers, commitments, ...})

3. Agent: GET /api/weather + Payment: <base64 header>

4. Sunucu (Middleware):
   a) Rate limit kontrolü (IP bazlı)
   b) Payment header decode
   c) extDataHash doğrulama (front-running koruması)
   d) Relayer/fee doğrulama
   e) decryptNote(enc1, serverEcdhPriv, agentEcdhPub)
      → amount >= price mı? ✓
      → pubkey = serverPubkey mi? ✓
   f) Pre-flight: isKnownRoot() + nullifier kontrolü
   g) Off-chain snarkjs kanıt doğrulama
   h) On-chain: pool.transact() çağrısı                    ← Zincir işlemi
   i) TX onay bekle

5. Sunucu: HTTP 200 + {temp: 22, city: "Istanbul"}
   X-Payment-TxHash: 0xabc...

6. Agent: API yanıtını işle, UTXO durumunu güncelle
```

### Bu Akışta Gizlilik Nerede?

| Adım | Gizli mi? | Açıklama |
|------|-----------|----------|
| Agent → Sunucu HTTP | HTTPS ile gizli | TLS şifreli |
| Payment header | Base64, HTTPS | Sadece sunucu görür |
| enc1 (ödeme notu) | AES-256-GCM | Sadece sunucu decrypt edebilir |
| enc2 (para üstü) | AES-256-GCM | Sadece agent decrypt edebilir |
| pool.transact() | Zincirde AÇIK ama anlamsız | publicAmount=0, nullifier bağlantısız |
| Miktar | **TAM GİZLİ** | Ne zincirde ne başka yerde görünür |
| Gönderici | **TAM GİZLİ** | Nullifier → gönderici bağlantısı yok |
| Alıcı | **SUNUCU BİLİR** | Sunucu kendisi alıcı (by design) |
| 3. Parti | **HİÇBİR ŞEY** | Zincir gözlemcisi anlamsız sayılar görür |

---

## 6. Protokol Ücreti (Circuit-Level Fee)

Ücret ZK circuit seviyesinde zorunlu tutulur — atlanamaz:

```
Circuit denklemi:
  sum(girdiler) + publicAmount = sum(çıktılar) + protocolFee

Ücret hesabı:
  fee = max(amount × 0.001, 10000)  → max(%0.1, $0.01)
```

Bu, proof'un kendisinin bir parçasıdır. Yanlış ücret → geçersiz kanıt → zincir reddeder.

---

## 7. Güvenlik Katmanları

```
┌─────────────────────────────────────────────────────┐
│  Katman 7: View Tags (tarama gizliliği)            │
├─────────────────────────────────────────────────────┤
│  Katman 6: AES-256-GCM Note Encryption             │
│           (UTXO verileri şifreli)                   │
├─────────────────────────────────────────────────────┤
│  Katman 5: secp256k1 ECDH Key Exchange             │
│           (ortak anahtar türetme)                   │
├─────────────────────────────────────────────────────┤
│  Katman 4: Groth16 ZK Proof (JoinSplit)            │
│           (denge, sahiplik, üyelik kanıtı)          │
├─────────────────────────────────────────────────────┤
│  Katman 3: Poseidon Hash (commitment + nullifier)  │
│           (tek yönlü, collision-resistant)          │
├─────────────────────────────────────────────────────┤
│  Katman 2: Merkle Tree (depth 20)                  │
│           (UTXO üyelik kanıtı)                     │
├─────────────────────────────────────────────────────┤
│  Katman 1: UTXO Model (JoinSplit)                  │
│           (girdi/çıktı bağlantısız)                │
├─────────────────────────────────────────────────────┤
│  Katman 0: Base L2 (Ethereum güvenliği)            │
└─────────────────────────────────────────────────────┘
```

---

## 8. Kontratlar (Base Sepolia — Canlı)

| Kontrat | Adres | Rolü |
|---------|-------|------|
| ShieldedPoolV4 | `0x8F1ae8209156C22dFD972352A415880040fB0b0c` | Ana havuz kontratı |
| Groth16Verifier_1x2 | `0xC53c8E05661450919951f51E4da829a3AABD76A2` | 1-girdi-2-çıktı kanıt doğrulayıcı |
| Groth16Verifier_2x2 | `0xE77ad940291c97Ae4dC43a6b9Ffb43a3AdCd4769` | 2-girdi-2-çıktı kanıt doğrulayıcı |
| PoseidonHasher | `0x70Aa742C113218a12A6582f60155c2B299551A43` | Poseidon hash hesaplayıcı |

Deploy bloğu: `38347380`

---

## 9. Proje Yapısı

```
privagent/
├── contracts/              Solidity (Foundry) — 117 test
│   ├── src/ShieldedPoolV4.sol     Ana havuz kontratı
│   ├── src/PoseidonHasher.sol     Poseidon hash
│   └── test/                      Foundry testleri
├── circuits/               Circom — JoinSplit ZK devreleri
│   ├── src/joinSplit.circom       1x2 ve 2x2 JoinSplit
│   └── build/                     Derlenmiş devre + key'ler
├── sdk/                    TypeScript SDK — 109 test
│   ├── src/v4/                    UTXO engine, şifreleme, not deposu
│   │   ├── shieldedWallet.ts      Ana cüzdan API'si
│   │   ├── noteEncryption.ts      ECDH + AES-256-GCM
│   │   ├── utxo.ts                UTXO oluşturma, commitment, nullifier
│   │   ├── viewTag.ts             View tag hesaplama
│   │   ├── noteStore.ts           Şifreli not deposu (AES-256-GCM)
│   │   ├── coinSelection.ts       UTXO seçim algoritması
│   │   ├── joinSplitProver.ts     ZK kanıt üretici
│   │   └── treeSync.ts            Merkle ağaç senkronizasyonu
│   └── src/x402/                  x402 protokol katmanı
│       ├── zkExactSchemeV2.ts     İstemci: ZK ödeme oluşturma
│       ├── middlewareV2.ts        Sunucu: Express paywall middleware
│       ├── externalRelay.ts       Harici relayer iletişimi
│       ├── facilitatorServer.ts   x402 facilitator sunucu
│       └── relayerServer.ts       Relayer sunucu
├── packages/               Ek paketler
│   ├── openclaw-skill/            OpenClaw agent skill'i
│   └── virtuals-plugin/           Virtuals agent eklentisi
├── app/                    Demo web uygulaması (Next.js 14)
├── examples/               Entegrasyon örnekleri
├── scripts/                Deploy ve test scriptleri
└── docs/                   Protokol dokümantasyonu
```

---

## 10. Özet Tablo

| Soru | Cevap |
|------|-------|
| **Ne?** | Base L2 üzerinde AI agent'lar için gizli USDC ödeme protokolü |
| **Neden?** | Agent ödemeleri herkese açık → strateji sızıntısı, MEV, rekabet istihbaratı |
| **Nasıl?** | ZK-UTXO (Groth16 + Poseidon) + ECDH note encryption (AES-256-GCM) |
| **Stealth neden kaldırıldı?** | Miktarları gizleyemiyordu, UTXO modeline uymuyordu, gereksiz karmaşıklık |
| **ECDH ne sağlıyor?** | Ortak anahtar olmadan şifreleme key türetme → UTXO verilerini AES ile şifreleme |
| **Kim ne biliyor?** | Sunucu: ödeme miktarı (by design). Gözlemci: hiçbir şey. Agent: kendi bakiyesi |
| **Zincirde ne görünür?** | Anlamsız sayılar: proof, nullifier, commitment, viewTag |
| **Test sayısı** | 226 (117 Foundry + 109 SDK) |
| **Lisans** | BUSL-1.1 (2028'de GPL-2.0'a dönüşür) |

---

## 11. Gerçek Zincir Üstü İşlem Analizi (Base Sepolia)

Aşağıda 2 Mart 2026'da Base Sepolia'da gerçekleştirilen 3 gerçek işlemin zincir üstü verileri incelenmektedir. Bu veriler `cast receipt` komutu ile doğrudan blockchain'den çekilmiştir.

### 11.1. DEPOSIT — 2 USDC Yatırma

**TX:** `0x12526471c879d2f75d89c90ed8bf1e94a5b29ef83d6a5e3f6a37f0cc41cb80dc`
**Blockscout:** [Görüntüle](https://base-sepolia.blockscout.com/tx/0x12526471c879d2f75d89c90ed8bf1e94a5b29ef83d6a5e3f6a37f0cc41cb80dc)

```
Zincirde Görünen Event'ler:
──────────────────────────
NewNullifier:    0x1b1d4d57f53afa14c7c7b1f73c2cdde5118bc85647d96edeba4cc2ecfea1b579
                 → Dummy input (deposit'te gerçek bir UTXO harcanmıyor, sahte nullifier)

NewCommitment #1: 0x2b7002c86ef290b15b21128c5487653c39249b4a562ba0234afbeb2ed8a4bf86
                  leafIndex: 4, viewTag: 0xb6
                  → Yatırılan USDC'nin UTXO commitment'ı (miktar GİZLİ)

NewCommitment #2: 0x0da2db62bbc70712778621e5247f519eae23a6f0878f152dd0947afaff1e7682
                  leafIndex: 5, viewTag: 0xb6
                  → Para üstü UTXO'su (bu durumda 0 olabilir)

USDC Transfer:   1,990,000 (1.99 USDC) → Havuz kontratına
                 10,000 (0.01 USDC) → Treasury'ye (protokol ücreti)

PublicDeposit:   depositor = 0xF505e...aaE5ae
                 amount = 2,000,000 (2 USDC)
```

**Gözlemci ne çıkarabilir?**
- "0xF505e... adresi 2 USDC yatırdı" → **EVET, görünür** (deposit doğası gereği açık)
- "Para ShieldedPoolV4 kontratına gitti" → **EVET** (havuz adresi açık)
- "2 commitment oluşturuldu ama ne kadar USDC içerdikleri" → **BİLİNMEZ**

---

### 11.2. PRIVATE TRANSFER — Havuz İçi Gizli Transfer

**TX:** `0xd5924f3b9366f0162bc97744bed71756bc1ae4d470e8f2bef9380e7d527bf500`
**Blockscout:** [Görüntüle](https://base-sepolia.blockscout.com/tx/0xd5924f3b9366f0162bc97744bed71756bc1ae4d470e8f2bef9380e7d527bf500)

```
Zincirde Görünen Event'ler:
──────────────────────────
NewNullifier:    0x035bf763ee74f406b2542d341fab52d2bf2edc05f41658c9e05b434bd3ce44cb
                 → Harcanan UTXO'nun nullifier'ı
                 → Bu nullifier'dan hangi UTXO'nun harcandığı ÇIKARILAMAz

NewCommitment #1: 0x11875bf8fd354193c8ecca55c64b31133f09665e57c27467c2cf0ffe07daf72a
                  leafIndex: 6, viewTag: 0xe7
                  → Alıcının UTXO'su (miktar + alıcı GİZLİ)

NewCommitment #2: 0x0711ed215cc0b4b7593a09c5ad45876b9491c09f26ad9702baf04cb04e022df3
                  leafIndex: 7, viewTag: 0xb6
                  → Göndericinin para üstü UTXO'su (miktar GİZLİ)

USDC Transfer:   SADECE 10,000 (0.01 USDC) → Treasury'ye (protokol ücreti)
                 → Başka hiçbir USDC hareketi YOK

publicAmount:    0 → "Havuzdan para giriş/çıkış yok" (tam gizli transfer)

ProtocolFeeCollected: 10,000 (0.01 USDC)
```

**Gözlemci ne çıkarabilir?**
- "Bir JoinSplit işlemi yapıldı" → **EVET**
- "publicAmount=0 → bu gizli bir transfer" → **EVET** (deposit/withdraw değil)
- "0.01 USDC protokol ücreti ödendi" → **EVET**
- "Ne kadar transfer edildi?" → **BİLİNMEZ** (sadece 0.01 ücret görünür)
- "Kim gönderdi?" → **BİLİNMEZ** (nullifier → gönderici bağlantısı yok)
- "Kime gönderildi?" → **BİLİNMEZ** (commitment = hash, içi çözülemez)
- "Bu nullifier hangi deposit'e ait?" → **BİLİNMEZ** (nullifier bağlantısız)

**Dikkat:** TX'i gönderen adres (msg.sender) `0xF505e...aaE5ae` görünür — ama bu **relayer** adresi, gerçek gönderici veya alıcı DEĞİL. Production'da sunucu TX'i gönderir, agent'ın Ethereum adresi hiç görünmez.

---

### 11.3. WITHDRAW — 0.97 USDC Çekme

**TX:** `0x89092edcb906e3b3e87354b25e5e04f88b56b5dfca8ca21e5e62e1d4e8bf8e1d`
**Blockscout:** [Görüntüle](https://base-sepolia.blockscout.com/tx/0x89092edcb906e3b3e87354b25e5e04f88b56b5dfca8ca21e5e62e1d4e8bf8e1d)

```
Zincirde Görünen Event'ler:
──────────────────────────
NewNullifier:    0x0393854722ae903e87521cc18b04627998b8488af510725dbece2f06eee30930
                 → Harcanan UTXO'nun nullifier'ı

NewCommitment #1: 0x134ba048ebd0ccda111aa086de106aef58fb23a0ff02f6314647b17b09a038d4
                  leafIndex: 8
                  → Para üstü (kalan bakiye) UTXO'su

NewCommitment #2: 0x142ddbc23e9345e637474af59b8e60f1cfc6b0ab8337d2502f97b203bad646dd
                  leafIndex: 9
                  → Boş/sıfır UTXO (tüm bakiye çekiliyorsa)

USDC Transfer:   970,000 (0.97 USDC) → 0xF505e... adresine (alıcı)
                 10,000 (0.01 USDC) → Treasury'ye (protokol ücreti)

PublicWithdraw:  recipient = 0xF505e...aaE5ae
                 amount = 970,000 (0.97 USDC)
```

**Gözlemci ne çıkarabilir?**
- "0xF505e... adresine 0.97 USDC çekildi" → **EVET, görünür** (withdraw doğası gereği açık)
- "Bu çekimin önceki hangi deposit ile ilişkili olduğu" → **BİLİNMEZ** (nullifier bağlantısız)
- "Çekilen kişinin havuzdaki toplam bakiyesi" → **BİLİNMEZ**

---

### 11.4. Özet: 3 İşlem Karşılaştırması

| Veri | Deposit | Private Transfer | Withdraw |
|------|---------|-----------------|----------|
| **Miktar** | AÇIK (2 USDC) | **GİZLİ** | AÇIK (0.97 USDC) |
| **Gönderici** | AÇIK (depositor) | **GİZLİ** | Nullifier (bağlantısız) |
| **Alıcı** | Commitment (gizli) | **GİZLİ** | AÇIK (recipient addr) |
| **Bağlantı** | Deposit → UTXO: YOK | Input → Output: YOK | UTXO → Withdraw: YOK |
| **USDC hareketi** | 2 USDC → Pool | Sadece 0.01 fee | 0.97 USDC + 0.01 fee |
| **publicAmount** | 2,000,000 (pozitif) | **0** | -970,000 (negatif) |

**Kritik nokta:** Deposit ve Withdraw doğaları gereği kısmen açıktır (para zincire girer/çıkar). Ama **private transfer tamamen gizlidir** — sadece 0.01 USDC protokol ücreti görünür, başka hiçbir bilgi sızmaz.

---

## 12. Commitment ve Nullifier'lar Neye Benzer?

### 12.1. Poseidon Public Key

Poseidon public key, private key'in Poseidon hash'idir. Zincir üzerinde GÖRÜNMEZ — sadece commitment hash'inin içinde gömülüdür.

```
privateKey = 777  (gizli, sadece sahibi bilir)
publicKey  = Poseidon(777)
           = 8314022328977600502360236309892451910870238061452047842843754277126098679161
           = 0x126191e3989103e8ec96310a454135e2fd7cefd642eac92aef8f801aa2dc7579
```

Bu public key **doğrudan zincirde hiçbir yerde görünmez.** Sadece commitment'ın bir bileşeni olarak hash'in içine girer.

### 12.2. Commitment

Commitment = `Poseidon(amount, pubkey, blinding)`

```
amount   = 1,000,000  (1 USDC)
pubkey   = Poseidon(777)
blinding = rastgele 31-byte alan elemanı

commitment = Poseidon(1000000, pubkey, blinding)
           = 0x2b7002c86ef290b15b21128c5487653c39249b4a562ba0234afbeb2ed8a4bf86
```

**Zincirde bu hash görünür** ama içinden amount, pubkey veya blinding çıkarılamaz. Poseidon hash tek yönlüdür.

### 12.3. Blinding Factor'ün Önemi

Aynı miktar + aynı alıcı = **her seferinde FARKLI commitment:**

```
UTXO 1: Poseidon(1000000, pubkey_Bob, blinding_A) = 0x2c4d2ff03d5d194a58a0bdee6bda7780ed3482a6493ef6892874340712ea1306
UTXO 2: Poseidon(1000000, pubkey_Bob, blinding_B) = 0x23e59c1cae6e65b8669e6347dcde7452d0dbd80f3eb7cb66bfb5c3719183dd1c
UTXO 3: Poseidon(1000000, pubkey_Bob, blinding_C) = 0x1c9f7de04d48eda48ce994d2390cd90c923e5f3d61dce284e56e0d0ed9a65179
```

Bir gözlemci bu 3 commitment'ı görse bile:
- Aynı miktarda olduklarını **bilemez**
- Aynı kişiye ait olduklarını **bilemez**
- Birbirleriyle ilişkili olduklarını **bilemez**

### 12.4. Nullifier ve Bağlantısızlık

Nullifier = `Poseidon(commitment, leafIndex, privateKey)`

```
commitment = 0x2b7002c8...  (zincirde görünen)
leafIndex  = 4               (zincirde görünen)
privateKey = 777              (GİZLİ)

nullifier  = Poseidon(commitment, 4, 777)
           = 0x035bf763...   (zincirde görünen)
```

Nullifier zincirde açıkça görünür ama:
- Nullifier → commitment bağlantısı **kurulamaz** (hash tek yönlü)
- Nullifier → privateKey bağlantısı **kurulamaz** (3 bilinmeyenli hash)
- İki farklı nullifier'ın aynı kişiye ait olup olmadığı **bilinemez**

---

## 13. 4-Hesap Demo: Gizlilik Pratikte Nasıl Çalışır?

4 farklı hesap oluşturup aralarında işlem yapalım. Her hesabın Poseidon keypair'i farklıdır:

```
Alice   (Agent A):   privateKey = 777
                     publicKey  = Poseidon(777)
                     = 8314022328977600502360236309892451910870238061452047842843754277126098679161
                     = 0x126191e3989103e8ec96310a454135e2fd7cefd642eac92aef8f801aa2dc7579

Bob     (Agent B):   privateKey = 888
                     publicKey  = Poseidon(888)
                     = 2747003115050001518199352967201636680005942106665862265253267848427325603405
                     = 0x0612bfa880c53eb3ad700aae4e79a035ee642f8736a83fec31dc9f8ee3d7be4d

Charlie (Server):    privateKey = 999
                     publicKey  = Poseidon(999)
                     = 12882099815397628243637726739664661604745181632246514661429068184196680242850
                     = 0x1c7b0296b0bf7b61b2dee3ef4afa79e7411d8b32bd3a5c06ca9b2fb5ee1fd6a2

Dave    (Relayer):   privateKey = 1111
                     publicKey  = Poseidon(1111)
                     = 936107041880948892627387585343503772163411492212883657371352110448043907916
                     = 0x0211d15bf9769e75824745084a9e07288534c8263cd0965fdd83a045a2e85b4c
```

### Senaryo: Alice → Bob'a 1 USDC Gizli Transfer

```
1. Alice'in UTXO'su:
   commitment_in = Poseidon(2000000, pubkey_Alice, blinding_x)
   → Merkle ağacında leafIndex 4'te

2. Alice JoinSplit kanıtı üretir:
   input:  [Alice'in 2 USDC UTXO'su]
   output: [Bob'a 1 USDC, Alice'e 1 USDC para üstü]

3. Zincirde görünen:
   nullifier     = Poseidon(commitment_in, 4, 777)    → Alice'in anahtarı GİZLİ
   commitment_1  = Poseidon(1000000, pubkey_Bob, r1)   → Bob'un UTXO'su, 1 USDC
   commitment_2  = Poseidon(1000000, pubkey_Alice, r2) → Alice'in para üstü
   publicAmount  = 0
   protocolFee   = 10000 (0.01 USDC)

4. Gözlemci (Dave dahil) şunları GÖREMEZ:
   ✗ commitment_1 = 1 USDC (miktar gizli)
   ✗ commitment_1 Bob'a ait (pubkey gizli)
   ✗ commitment_2 Alice'e ait (pubkey gizli)
   ✗ nullifier Alice'in UTXO'sundan geldi (bağlantısız)
   ✗ Alice ve Bob dahil oldu (hiçbir Ethereum adresi görünmüyor)

5. Bob commitment_1'i nasıl bulur?
   a) Tüm yeni commitment'ları tarar
   b) Her birinin viewTag'ını kontrol eder (1-byte hızlı filtre)
   c) Eşleşenleri ECDH + AES ile decrypt etmeye çalışır
   d) Decrypt başarılı → "Bu UTXO benim!" (amount=1000000, blinding=r1)
```

### 4-Hesap Demo Scripti

Bu senaryoyu gerçek Poseidon değerleriyle görmek için:

```bash
npx tsx scripts/demo-4accounts.ts
```

Bu script 4 hesap oluşturur, her biri için commitment ve nullifier hesaplar, ve on-chain'de neyin görünür neyin gizli olduğunu gösterir.

---

## 14. Sık Sorulan Sorular

### "Pool adresi ve relayer adresi görünüyor — bu gizlilik ihlali değil mi?"

**Hayır.** Pool adresi (`0x8F1ae...`) herkesin bildiği bir kontrat adresidir — Tornado Cash'in kontrat adresi de herkes tarafından bilinir. Relayer adresi (`0xF505e...`) TX'i gönderen sunucunun adresidir, gerçek gönderici veya alıcı değildir. Production'da sunucu TX'i gönderir, agent'ın Ethereum adresi hiç zincirde görünmez.

### "0.01 USDC ücret → transfer tutarı çıkarılabilir mi?"

**Hayır.** Ücret `max(%0.1, $0.01)` formülüyle hesaplanır. 0.01 USDC minimum ücret olduğu için, transfer tutarının 0.01 ile 10 USDC arasında olduğunu gösterir ama kesin tutarı ortaya çıkarmaz. 10 USDC üzerindeki transferlerde ücret %0.1 olur — bu durumda `fee / 0.001` ile tutarı hesaplamak mümkündür. Bu bilinen bir trade-off'tur ve V4.5'te sabit ücret seçeneği planlanmaktadır.

### "Deposit ve Withdraw açık — bu kullanışlı mı?"

**Evet.** Deposit ve Withdraw'un açık olması doğaldır — para blockchain'e girer veya çıkar, bu hareket gizlenemez. Ama **aralarındaki bağlantı gizlidir.** Alice 100 USDC yatırıp, Bob 50 USDC çektiğinde, bir gözlemci Alice'in Bob'a gönderip göndermediğini bilemez. Yeterli anonymity set (havuzda başka kullanıcılar) varsa, deposit→withdraw bağlantısı kurulamaz.

### "Poseidon public key zincirde görünüyor mu?"

**Hayır.** Poseidon public key hiçbir zaman doğrudan zincirde görünmez. Sadece commitment hash'inin bir bileşeni olarak hash'in içine girer: `commitment = Poseidon(amount, pubkey, blinding)`. Hash tek yönlü olduğu için, commitment'tan pubkey çıkarmak hesaplama açısından imkansızdır.

---

*Bu doküman PrivAgent V4.4 mimarisini açıklar. Teknik detaylar için bkz: [PROTOCOL.md](PROTOCOL.md), [CIRCUITS.md](CIRCUITS.md)*
