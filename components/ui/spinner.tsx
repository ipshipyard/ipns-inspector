export const Spinner = ({ className = '' }: { className?: string }) => {
  return (
    <div className="flex justify-center">
      <div className={`animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full ${className}`} />
    </div>
  )
}
