// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
var SkeletonType = /* @__PURE__ */ ((SkeletonType2) => {
  SkeletonType2["Fox"] = "fox";
  SkeletonType2["Human"] = "human";
  SkeletonType2["Bird"] = "bird";
  SkeletonType2["Dragon"] = "dragon";
  SkeletonType2["Kaiju"] = "kaiju";
  SkeletonType2["Spider"] = "spider";
  SkeletonType2["Snake"] = "snake";
  SkeletonType2["Fish"] = "fish";
  SkeletonType2["Horse"] = "horse";
  SkeletonType2["Error"] = "error";
  SkeletonType2["None"] = "none";
  return SkeletonType2;
})(SkeletonType || {});
var HandSkeletonType = /* @__PURE__ */ ((HandSkeletonType2) => {
  HandSkeletonType2["AllFingers"] = "all-fingers";
  HandSkeletonType2["ThumbAndIndex"] = "thumb-and-index";
  HandSkeletonType2["SimplifiedHand"] = "simplified-hand";
  HandSkeletonType2["SingleBone"] = "single-bone";
  return HandSkeletonType2;
})(HandSkeletonType || {});
export {
  HandSkeletonType,
  SkeletonType
};
